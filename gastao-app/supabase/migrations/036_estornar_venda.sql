-- =============================================================
-- Migration 036 — RPC estornar_venda (desfaz venda + devolve estoque)
--
-- PROBLEMA (auditoria UX 2026-07-08):
--   registrar_venda baixa estoque atomicamente, mas não havia caminho de
--   desfazer. Funcionário registra 100 no lugar de 10 → estoque zera e não há
--   como corrigir pela UI (dead-end). Estorno era impossível.
--
-- FIX:
--   RPC única, SECURITY DEFINER, espelho invertido da 022: valida que a venda
--   é do restaurante ativo, re-expande a árvore de composição e SOMA de volta
--   o estoque dos insumos-folha, depois apaga a venda. Atômica (rollback total
--   em erro).
--
-- LIMITAÇÃO CONHECIDA:
--   A devolução usa a composição ATUAL da ficha. Se a ficha mudou entre a venda
--   e o estorno, a quantidade devolvida reflete a receita de agora, não a do
--   momento da venda (não há ledger por venda). Aceitável — é o mesmo modelo
--   de baixa da 022 e cobre o caso real (erro de digitação corrigido na hora).
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.estornar_venda(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_restaurante uuid;
    v_recipe_id   uuid;
    v_qty         numeric;
BEGIN
    v_restaurante := public.get_my_restaurant_id();
    IF v_restaurante IS NULL THEN
        RAISE EXCEPTION 'Sem restaurante ativo';
    END IF;

    -- A venda tem que ser do restaurante ativo (bloqueia estorno cross-tenant)
    SELECT recipe_id, quantity_sold INTO v_recipe_id, v_qty
    FROM public.sales
    WHERE id = p_sale_id
      AND restaurant_id = v_restaurante;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Venda não encontrada ou sem permissão';
    END IF;

    -- Re-expande a árvore e DEVOLVE o estoque dos insumos-folha (espelho da 022)
    WITH RECURSIVE nodes AS (
        SELECT v_recipe_id AS rid, v_qty::numeric AS units, 0 AS depth
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
    SET stock_quantity = COALESCE(i.stock_quantity, 0) + c.qtd
    FROM consumo c
    WHERE i.id = c.iid
      AND i.restaurant_id = v_restaurante;

    -- Remove a venda
    DELETE FROM public.sales WHERE id = p_sale_id AND restaurant_id = v_restaurante;
END;
$$;

GRANT EXECUTE ON FUNCTION public.estornar_venda(uuid) TO authenticated;

COMMIT;
