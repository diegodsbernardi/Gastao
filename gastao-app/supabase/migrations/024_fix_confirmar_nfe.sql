-- =============================================================
-- Migration 024 — Corrige confirmar_nfe (4 bugs da auditoria)
--
-- M1: função SECURITY DEFINER sem SET search_path (search_path hijack).
-- M2: atualizava insumo por id sem validar que é do mesmo tenant da nota
--     (podia corromper estoque/custo de insumo de outro cliente).
-- M3: não era idempotente — confirmar 2x somava estoque de novo.
-- M4: usava unidade COMERCIAL (uCom, ex "2 CX") em vez da TRIBUTÁVEL (uTrib,
--     ex "KG") → estoque e custo médio corrompidos quando as unidades diferem.
-- =============================================================

BEGIN;

-- M3: 'confirmado' é um novo status terminal de item (marca item já processado)
ALTER TABLE public.nfe_itens DROP CONSTRAINT IF EXISTS nfe_itens_status_check;
ALTER TABLE public.nfe_itens
    ADD CONSTRAINT nfe_itens_status_check
    CHECK (status IN ('pendente', 'vinculado', 'ignorado', 'novo_insumo', 'confirmado'));

CREATE OR REPLACE FUNCTION public.confirmar_nfe(p_nota_fiscal_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public        -- M1
AS $$
DECLARE
    v_restaurante_id uuid;
    v_status         text;
    v_item           RECORD;
    v_insumo         RECORD;
    v_qtd            numeric;
    v_valor          numeric;
    v_novo_custo     numeric;
    v_processados    integer := 0;
BEGIN
    -- Nota do restaurante do usuário logado + status (M3: idempotência)
    SELECT restaurante_id, status INTO v_restaurante_id, v_status
    FROM public.notas_fiscais
    WHERE id = p_nota_fiscal_id
      AND restaurante_id = get_my_restaurant_id();

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
        -- M2: insumo tem que ser do MESMO restaurante da nota
        SELECT id, stock_quantity, avg_cost_per_unit
        INTO v_insumo
        FROM public.ingredients
        WHERE id = v_item.insumo_confirmado_id
          AND restaurant_id = v_restaurante_id;

        IF NOT FOUND THEN CONTINUE; END IF;

        -- M4: prefere unidade tributável (física, ex KG) à comercial (ex CX)
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

        UPDATE public.ingredients
        SET avg_cost_per_unit = v_novo_custo,
            stock_quantity    = COALESCE(stock_quantity, 0) + v_qtd
        WHERE id = v_item.insumo_confirmado_id;

        -- M3: marca o item como confirmado (não reprocessa)
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
