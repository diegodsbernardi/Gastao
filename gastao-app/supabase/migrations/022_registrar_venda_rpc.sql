-- =============================================================
-- Migration 022 — RPC registrar_venda (baixa de estoque atômica + recursiva)
--
-- PROBLEMA (auditoria):
--   O registro de venda no frontend (Sales.tsx) inseria a venda e depois
--   fazia baixa de estoque em loop read-modify-write:
--     • Ignorava preparos (só percorria recipe_ingredients diretos) → insumos
--       usados via preparo nunca baixavam.
--     • Não-atômico → duas vendas simultâneas perdiam uma baixa; falha no meio
--       deixava venda registrada sem baixa (ou baixa parcial).
--
-- FIX:
--   RPC única, SECURITY DEFINER, que valida tenant, insere a venda e baixa o
--   estoque de TODOS os insumos-folha, expandindo preparos recursivamente
--   (nos dois locais de armazenamento: recipe_ingredients.sub_recipe_id E
--   recipe_sub_recipes). Consumo por folha espelha o costCalculator:
--     qtd_insumo = quantity_needed * unidades_consumidas / yield_quantity
--   Guarda contra ciclos com limite de profundidade.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.registrar_venda(
    p_recipe_id   uuid,
    p_qty         numeric,
    p_unit_price  numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_restaurante uuid;
    v_recipe_rest uuid;
    v_sale_id     uuid;
BEGIN
    IF p_qty IS NULL OR p_qty <= 0 THEN
        RAISE EXCEPTION 'Quantidade inválida';
    END IF;

    v_restaurante := public.get_my_restaurant_id();
    IF v_restaurante IS NULL THEN
        RAISE EXCEPTION 'Sem restaurante ativo';
    END IF;

    -- A receita tem que ser do restaurante ativo (bloqueia venda cross-tenant)
    SELECT restaurant_id INTO v_recipe_rest FROM public.recipes WHERE id = p_recipe_id;
    IF v_recipe_rest IS NULL OR v_recipe_rest <> v_restaurante THEN
        RAISE EXCEPTION 'Receita não pertence ao restaurante ativo';
    END IF;

    -- 1. Registra a venda
    INSERT INTO public.sales (restaurant_id, recipe_id, quantity_sold, unit_price, total_value)
    VALUES (v_restaurante, p_recipe_id, p_qty, COALESCE(p_unit_price, 0), p_qty * COALESCE(p_unit_price, 0))
    RETURNING id INTO v_sale_id;

    -- 2. Expande a árvore de composição e baixa estoque dos insumos-folha
    WITH RECURSIVE nodes AS (
        -- raiz: a ficha vendida, com p_qty unidades de saída consumidas
        SELECT p_recipe_id AS rid, p_qty::numeric AS units, 0 AS depth
        UNION ALL
        SELECT child.sub_recipe_id,
               n.units * child.quantity_needed / COALESCE(NULLIF(r.yield_quantity, 0), 1),
               n.depth + 1
        FROM nodes n
        JOIN public.recipes r ON r.id = n.rid
        JOIN (
            SELECT recipe_id, sub_recipe_id, quantity_needed
            FROM public.recipe_ingredients WHERE sub_recipe_id IS NOT NULL
            UNION ALL
            SELECT recipe_id, sub_recipe_id, quantity_needed
            FROM public.recipe_sub_recipes
        ) child ON child.recipe_id = n.rid
        WHERE n.depth < 20   -- guarda anti-ciclo
    ),
    consumo AS (
        SELECT ri.ingredient_id AS iid,
               SUM(ri.quantity_needed * n.units / COALESCE(NULLIF(r.yield_quantity, 0), 1)) AS qtd
        FROM nodes n
        JOIN public.recipes r ON r.id = n.rid
        JOIN public.recipe_ingredients ri
             ON ri.recipe_id = n.rid AND ri.ingredient_id IS NOT NULL
        GROUP BY ri.ingredient_id
    )
    UPDATE public.ingredients i
    SET stock_quantity = i.stock_quantity - c.qtd
    FROM consumo c
    WHERE i.id = c.iid
      AND i.restaurant_id = v_restaurante;

    RETURN v_sale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_venda(uuid, numeric, numeric) TO authenticated;

COMMIT;
