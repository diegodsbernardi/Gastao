-- =============================================================
-- Migration 035 — confirmar_nfe converte unidade (fim do erro de 100-1000x)
--
-- PROBLEMA (auditoria de arquitetura 2026-07-08):
--   A 024 fez confirmar_nfe preferir a unidade TRIBUTÁVEL (KG) à COMERCIAL
--   (CX), mas nunca converteu a FAMÍLIA de unidade nota→insumo. Se o insumo
--   é cadastrado em `g` e a nota vem em `KG`, confirmar_nfe grava R$/KG como
--   se fosse R$/g → custo médio 1000x inflado e stock_quantity 1000x
--   subestimado. O CMV do prato explode e ainda dispara cmv_alertas falso.
--   A 031 (aplicar_custos_nfe) já resolveu isso com nfe_fator_conversao()
--   (whitelist estrita — embalagens nunca convertem), mas o fix nunca foi
--   portado pro confirmar_nfe, que é o fluxo principal e mexe em estoque.
--
-- FIX:
--   Porta nfe_fator_conversao() pra dentro do loop de confirmar_nfe.
--   • fator NÃO-NULO: converte custo (valor_nota × fator) e quantidade
--     (qtd_nota / fator) pra unidade do insumo antes da média móvel/estoque.
--   • fator NULO (embalagem, família divergente, unidade desconhecida):
--     PULA o item — não atualiza custo nem estoque. Melhor não receber do que
--     corromper 1000x. (Item fica 'vinculado' pra reprocessar após acerto de
--     unidade; a nota só vira 'confirmada' no fim, como antes.)
--
--   Regressão zero no caso que já funcionava: nota KG + insumo kg → fator=1
--   → resultado idêntico ao anterior.
--
--   Coordenação com aplicar_custos_nfe (031): confirmar_nfe passa a carimbar
--   custo_aplicado_em nos itens processados, marcando que o custo já veio
--   desta nota (a prévia da 031 filtra custo_aplicado_em IS NULL).
-- =============================================================

BEGIN;

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
    v_un_nota        text;
    v_fator          numeric;
    v_qtd_nota       numeric;
    v_valor_nota     numeric;
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
               quantidade, valor_unitario, unidade,
               quantidade_tributavel, valor_unitario_tributavel, unidade_tributavel
        FROM public.nfe_itens
        WHERE nota_fiscal_id = p_nota_fiscal_id
          AND status = 'vinculado'
          AND insumo_confirmado_id IS NOT NULL
    LOOP
        SELECT id, stock_quantity, avg_cost_per_unit, unit_type
        INTO v_insumo
        FROM public.ingredients
        WHERE id = v_item.insumo_confirmado_id
          AND restaurant_id = v_restaurante_id;

        IF NOT FOUND THEN CONTINUE; END IF;

        -- Unidade da nota: tributável preferida (mesma escolha da prévia 031)
        v_un_nota := COALESCE(NULLIF(v_item.unidade_tributavel, ''), v_item.unidade);
        v_fator   := public.nfe_fator_conversao(v_un_nota, v_insumo.unit_type);

        -- Sem fator confiável (embalagem CX/FD, família divergente, unidade
        -- desconhecida): NÃO atualiza custo nem estoque. Evita corromper
        -- 100-1000x. Item continua 'vinculado' pra reprocessar após acerto.
        IF v_fator IS NULL THEN
            CONTINUE;
        END IF;

        v_qtd_nota   := COALESCE(v_item.quantidade_tributavel, v_item.quantidade);
        v_valor_nota := COALESCE(v_item.valor_unitario_tributavel, v_item.valor_unitario);

        -- Converte pra unidade do insumo:
        --   custo/insumo-un = valor/nota-un × fator   (KG→g: R$25/KG → R$0,025/g)
        --   qtd  insumo-un  = qtd/nota-un  ÷ fator     (KG→g: 20 KG   → 20000 g)
        v_valor := v_valor_nota * v_fator;
        v_qtd   := v_qtd_nota / v_fator;

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

        -- Marca processado + carimba custo (coordenação com aplicar_custos_nfe)
        UPDATE public.nfe_itens
        SET status = 'confirmado',
            custo_aplicado_em = now()
        WHERE id = v_item.id;

        v_processados := v_processados + 1;
    END LOOP;

    UPDATE public.notas_fiscais
    SET status = 'confirmada'
    WHERE id = p_nota_fiscal_id;

    RETURN v_processados;
END;
$$;

COMMIT;
