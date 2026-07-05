-- =============================================================
-- Migration 031 — Prévia e aplicação de custos a partir de NF-e pendentes
--
-- Frente A do plano: atualizar ingredients.avg_cost_per_unit a partir das
-- notas importadas SEM confirmar a nota e SEM tocar estoque.
-- Fonte única da fórmula: previa_custos_nfe(). A aplicação lê a própria
-- prévia — o cliente só envia UUIDs de itens, nunca números.
-- Conversão de unidade por whitelist estrita (bug histórico de 100-1000x):
-- embalagens (CX/FD/PCT/DZ/SC/...) NUNCA convertem.
-- =============================================================

BEGIN;

ALTER TABLE public.nfe_itens
    ADD COLUMN IF NOT EXISTS custo_aplicado_em timestamptz;

-- ── Fator de conversão nota → insumo ────────────────────────────────────────
-- custo_insumo = valor_da_nota × fator. Ex.: nota em KG, insumo em g → 0.001.
-- Famílias diferentes ou unidade fora da whitelist → NULL (não converte).
CREATE OR REPLACE FUNCTION public.nfe_fator_conversao(p_un_nota text, p_un_insumo text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
    WITH nota AS (
        SELECT familia, base FROM (VALUES
            ('KG','massa',1000::numeric), ('KILO','massa',1000), ('KGS','massa',1000),
            ('G','massa',1), ('GR','massa',1), ('GRS','massa',1),
            ('L','vol',1000), ('LT','vol',1000), ('LTS','vol',1000), ('LTR','vol',1000),
            ('ML','vol',1),
            ('UN','un',1), ('UND','un',1), ('UNID','un',1), ('UNI','un',1), ('PC','un',1)
        ) AS t(un, familia, base)
        WHERE un = upper(trim(p_un_nota))
    ),
    insumo AS (
        SELECT familia, base FROM (VALUES
            ('kg','massa',1000::numeric), ('g','massa',1),
            ('l','vol',1000), ('ml','vol',1),
            ('un','un',1)
        ) AS t(un, familia, base)
        WHERE un = lower(trim(p_un_insumo))
    )
    SELECT CASE WHEN nota.familia = insumo.familia THEN insumo.base / nota.base END
    FROM nota, insumo;
$$;

-- ── Prévia (read-only) ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.previa_custos_nfe()
RETURNS TABLE (
    item_id         uuid,
    nota_id         uuid,
    numero_nota     text,
    fornecedor      text,
    data_emissao    timestamptz,
    origem          text,
    insumo_id       uuid,
    insumo_nome     text,
    insumo_unidade  text,
    origem_match    text,
    confianca       numeric,
    descricao_xml   text,
    qtd_nota        numeric,
    unidade_nota    text,
    valor_unit_nota numeric,
    fator           numeric,
    custo_atual     numeric,
    custo_novo      numeric,
    variacao_pct    numeric,
    eh_mais_recente boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH base AS (
        SELECT ni.id AS item_id, nf.id AS nota_id, nf.numero_nota,
               nf.fornecedor_nome AS fornecedor, nf.data_emissao, nf.origem,
               ni.criado_em,
               COALESCE(ni.insumo_confirmado_id, ni.insumo_sugerido_id) AS insumo_id,
               CASE WHEN ni.insumo_confirmado_id IS NOT NULL THEN 'confirmado' ELSE 'sugerido' END AS origem_match,
               ni.confianca_match AS confianca, ni.descricao_xml,
               COALESCE(ni.quantidade_tributavel, ni.quantidade) AS qtd_nota,
               COALESCE(NULLIF(ni.unidade_tributavel, ''), ni.unidade) AS unidade_nota,
               COALESCE(ni.valor_unitario_tributavel, ni.valor_unitario) AS valor_unit_nota
        FROM nfe_itens ni
        JOIN notas_fiscais nf ON nf.id = ni.nota_fiscal_id
        WHERE nf.restaurante_id = get_my_restaurant_id()
          AND nf.status = 'pendente'
          AND ni.status <> 'ignorado'
          AND ni.custo_aplicado_em IS NULL
          AND COALESCE(ni.insumo_confirmado_id, ni.insumo_sugerido_id) IS NOT NULL
    )
    SELECT b.item_id, b.nota_id, b.numero_nota, b.fornecedor, b.data_emissao, b.origem,
           b.insumo_id, ing.name AS insumo_nome, ing.unit_type AS insumo_unidade,
           b.origem_match, b.confianca, b.descricao_xml,
           b.qtd_nota, b.unidade_nota, b.valor_unit_nota,
           f.fator,
           ing.avg_cost_per_unit AS custo_atual,
           CASE WHEN f.fator IS NOT NULL THEN round(b.valor_unit_nota * f.fator, 6) END AS custo_novo,
           CASE WHEN f.fator IS NOT NULL AND COALESCE(ing.avg_cost_per_unit, 0) > 0
                THEN round((b.valor_unit_nota * f.fator / ing.avg_cost_per_unit - 1) * 100, 1)
           END AS variacao_pct,
           (row_number() OVER (
                PARTITION BY b.insumo_id
                ORDER BY (f.fator IS NOT NULL) DESC, b.data_emissao DESC NULLS LAST, b.criado_em DESC
           ) = 1) AS eh_mais_recente
    FROM base b
    JOIN ingredients ing
      ON ing.id = b.insumo_id
     AND ing.restaurant_id = get_my_restaurant_id()
    CROSS JOIN LATERAL (SELECT public.nfe_fator_conversao(b.unidade_nota, ing.unit_type) AS fator) f;
$$;

GRANT EXECUTE ON FUNCTION public.previa_custos_nfe() TO authenticated;

-- ── Aplicação ───────────────────────────────────────────────────────────────
-- Recebe os itens escolhidos na prévia. Por insumo, vence a nota mais recente.
-- NUNCA toca stock_quantity. Dispara cmv_alertas acima do threshold (reuso 030).
CREATE OR REPLACE FUNCTION public.aplicar_custos_nfe(p_item_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rest      uuid;
    v_threshold numeric;
    v_row       RECORD;
    v_atual     numeric;
    v_variacao  numeric;
    v_aplicados integer := 0;
BEGIN
    v_rest := get_my_restaurant_id();
    IF v_rest IS NULL THEN
        RAISE EXCEPTION 'Sem restaurante ativo';
    END IF;

    SELECT alerta_cmv_pct INTO v_threshold FROM restaurantes WHERE id = v_rest;

    FOR v_row IN
        SELECT DISTINCT ON (p.insumo_id) p.insumo_id, p.custo_novo, p.nota_id
        FROM public.previa_custos_nfe() p
        WHERE p.item_id = ANY(p_item_ids)
          AND p.fator IS NOT NULL
          AND p.custo_novo > 0
        ORDER BY p.insumo_id, p.data_emissao DESC NULLS LAST
    LOOP
        SELECT avg_cost_per_unit INTO v_atual
        FROM ingredients
        WHERE id = v_row.insumo_id AND restaurant_id = v_rest
        FOR UPDATE;

        IF NOT FOUND THEN CONTINUE; END IF;

        IF COALESCE(v_atual, 0) > 0 THEN
            v_variacao := (v_row.custo_novo / v_atual - 1) * 100;
            IF abs(v_variacao) >= v_threshold THEN
                INSERT INTO cmv_alertas
                    (restaurante_id, insumo_id, nota_fiscal_id,
                     custo_antes, custo_depois, variacao_pct, fichas_afetadas)
                VALUES
                    (v_rest, v_row.insumo_id, v_row.nota_id,
                     v_atual, v_row.custo_novo, round(v_variacao, 1),
                     public.fichas_afetadas_por_insumo(v_row.insumo_id, v_rest));
            END IF;
        END IF;

        UPDATE ingredients
        SET avg_cost_per_unit = v_row.custo_novo
        WHERE id = v_row.insumo_id;

        v_aplicados := v_aplicados + 1;
    END LOOP;

    -- Carimba TODOS os itens enviados (do tenant), vencedores ou não —
    -- sem isso, uma rodada futura reaplicaria preço de nota antiga.
    UPDATE nfe_itens ni
    SET custo_aplicado_em = now()
    FROM notas_fiscais nf
    WHERE ni.nota_fiscal_id = nf.id
      AND nf.restaurante_id = v_rest
      AND ni.id = ANY(p_item_ids);

    RETURN v_aplicados;
END;
$$;

GRANT EXECUTE ON FUNCTION public.aplicar_custos_nfe(uuid[]) TO authenticated;

COMMIT;
