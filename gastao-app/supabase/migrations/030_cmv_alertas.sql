-- =============================================================
-- Migration 030 — Alertas de variação de custo (impacto no CMV)
--
-- Quando a confirmação de uma NF-e altera o custo médio de um insumo além
-- do threshold do restaurante (default 10%), nasce um alerta com a lista de
-- fichas finais afetadas (sobe a árvore insumo → preparos → fichas).
-- O CMV antes/depois e a sugestão de preço são calculados no front,
-- que já tem o calculador de custo recursivo.
-- =============================================================

BEGIN;

ALTER TABLE public.restaurantes
    ADD COLUMN IF NOT EXISTS alerta_cmv_pct numeric NOT NULL DEFAULT 10;

CREATE TABLE IF NOT EXISTS public.cmv_alertas (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurante_id  uuid        NOT NULL REFERENCES public.restaurantes(id) ON DELETE CASCADE,
    insumo_id       uuid        NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
    nota_fiscal_id  uuid        REFERENCES public.notas_fiscais(id) ON DELETE SET NULL,
    custo_antes     numeric     NOT NULL,
    custo_depois    numeric     NOT NULL,
    variacao_pct    numeric     NOT NULL,      -- assinada: +25 = subiu 25%
    fichas_afetadas jsonb       NOT NULL DEFAULT '[]',  -- [{id, nome}]
    status          text        NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'visto')),
    criado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cmv_alertas_rest_status ON public.cmv_alertas (restaurante_id, status);

ALTER TABLE public.cmv_alertas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cmv_alertas_select" ON public.cmv_alertas;
CREATE POLICY "cmv_alertas_select" ON public.cmv_alertas
    FOR SELECT USING (restaurante_id = get_my_restaurant_id());

-- Usuário só marca visto (update); insert é sempre pelo confirmar_nfe (definer)
DROP POLICY IF EXISTS "cmv_alertas_update" ON public.cmv_alertas;
CREATE POLICY "cmv_alertas_update" ON public.cmv_alertas
    FOR UPDATE USING (restaurante_id = get_my_restaurant_id());

-- ── Fichas finais afetadas por um insumo (sobe a árvore de composição) ──────
-- Cobre as duas rotas de sub-receita: recipe_sub_recipes e a rota legada
-- recipe_ingredients.sub_recipe_id. UNION (não ALL) protege contra ciclos.
CREATE OR REPLACE FUNCTION public.fichas_afetadas_por_insumo(p_insumo uuid, p_restaurante uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    WITH RECURSIVE sobe AS (
        SELECT ri.recipe_id
        FROM recipe_ingredients ri
        WHERE ri.ingredient_id = p_insumo
        UNION
        SELECT pai.recipe_id
        FROM sobe
        JOIN (
            SELECT recipe_id, sub_recipe_id FROM recipe_sub_recipes
            UNION ALL
            SELECT recipe_id, sub_recipe_id FROM recipe_ingredients WHERE sub_recipe_id IS NOT NULL
        ) pai ON pai.sub_recipe_id = sobe.recipe_id
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'nome', r.product_name) ORDER BY r.product_name), '[]'::jsonb)
    FROM recipes r
    WHERE r.id IN (SELECT recipe_id FROM sobe)
      AND r.tipo = 'ficha_final'
      AND r.restaurant_id = p_restaurante;
$$;

-- ── confirmar_nfe v3: igual à 024 + dispara alerta de variação de custo ─────
CREATE OR REPLACE FUNCTION public.confirmar_nfe(p_nota_fiscal_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_restaurante_id uuid;
    v_status         text;
    v_threshold      numeric;
    v_item           RECORD;
    v_insumo         RECORD;
    v_qtd            numeric;
    v_valor          numeric;
    v_novo_custo     numeric;
    v_variacao       numeric;
    v_processados    integer := 0;
BEGIN
    SELECT nf.restaurante_id, nf.status, r.alerta_cmv_pct
    INTO v_restaurante_id, v_status, v_threshold
    FROM public.notas_fiscais nf
    JOIN public.restaurantes r ON r.id = nf.restaurante_id
    WHERE nf.id = p_nota_fiscal_id
      AND nf.restaurante_id = get_my_restaurant_id();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nota fiscal não encontrada ou sem permissão';
    END IF;

    IF v_status = 'confirmada' THEN
        RAISE EXCEPTION 'Nota já confirmada — operação ignorada para não duplicar estoque';
    END IF;

    FOR v_item IN
        SELECT id, insumo_confirmado_id,
               quantidade, valor_unitario,
               quantidade_tributavel, valor_unitario_tributavel
        FROM public.nfe_itens
        WHERE nota_fiscal_id = p_nota_fiscal_id
          AND status = 'vinculado'
          AND insumo_confirmado_id IS NOT NULL
    LOOP
        SELECT id, stock_quantity, avg_cost_per_unit
        INTO v_insumo
        FROM public.ingredients
        WHERE id = v_item.insumo_confirmado_id
          AND restaurant_id = v_restaurante_id;

        IF NOT FOUND THEN CONTINUE; END IF;

        v_qtd   := COALESCE(v_item.quantidade_tributavel, v_item.quantidade);
        v_valor := COALESCE(v_item.valor_unitario_tributavel, v_item.valor_unitario);

        IF COALESCE(v_insumo.stock_quantity, 0) <= 0 THEN
            v_novo_custo := v_valor;
        ELSE
            v_novo_custo := (
                (v_insumo.stock_quantity * COALESCE(v_insumo.avg_cost_per_unit, 0))
                + (v_qtd * v_valor)
            ) / (v_insumo.stock_quantity + v_qtd);
        END IF;

        IF v_novo_custo <= 0 THEN
            v_novo_custo := v_valor;
        END IF;

        -- Alerta de CMV: só quando havia custo anterior real e a variação
        -- passa do threshold do restaurante.
        IF COALESCE(v_insumo.avg_cost_per_unit, 0) > 0 THEN
            v_variacao := (v_novo_custo / v_insumo.avg_cost_per_unit - 1) * 100;
            IF abs(v_variacao) >= v_threshold THEN
                INSERT INTO public.cmv_alertas
                    (restaurante_id, insumo_id, nota_fiscal_id,
                     custo_antes, custo_depois, variacao_pct, fichas_afetadas)
                VALUES
                    (v_restaurante_id, v_insumo.id, p_nota_fiscal_id,
                     v_insumo.avg_cost_per_unit, v_novo_custo, round(v_variacao, 1),
                     public.fichas_afetadas_por_insumo(v_insumo.id, v_restaurante_id));
            END IF;
        END IF;

        UPDATE public.ingredients
        SET avg_cost_per_unit = v_novo_custo,
            stock_quantity    = COALESCE(stock_quantity, 0) + v_qtd
        WHERE id = v_item.insumo_confirmado_id;

        UPDATE public.nfe_itens SET status = 'confirmado' WHERE id = v_item.id;

        v_processados := v_processados + 1;
    END LOOP;

    UPDATE public.notas_fiscais
    SET status = 'confirmada'
    WHERE id = p_nota_fiscal_id;

    RETURN v_processados;
END;
$$;

COMMIT;
