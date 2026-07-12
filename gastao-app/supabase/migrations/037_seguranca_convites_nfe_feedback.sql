-- =============================================================
-- Migration 037 — Hardening de segurança: convites, NF-e e feedback
-- (auditoria de tenant-isolation 2026-07-12)
--
-- Fecha 3 brechas remanescentes de isolamento entre tenants:
--
--  A1 [BAIXO — correção de higiene + defesa-em-profundidade] convites_insert tautológica
--     A 034 recriou a policy com um EXISTS que qualifica a coluna do
--     restaurante SEM prefixo (`restaurante_id`), e dentro do subquery esse
--     nome liga ao alias interno `m.restaurante_id` — vira a auto-comparação
--     `m.restaurante_id = m.restaurante_id`, sempre verdadeira. Em tese isso
--     deixaria o EXISTS checar só "sou dono/bpo de ALGUM restaurante".
--     PORÉM, verificado em prod (12/07): a RLS de membros_select já restringe
--     o EXISTS ao restaurante ATIVO (get_my_restaurant_id()), então o atacante
--     nunca enxerga a própria membership privilegiada de outro tenant e o
--     ataque cross-tenant NÃO é reproduzível hoje. Por isso BAIXO, não crítico.
--     O fix vale mesmo assim: corrige a tautologia e blinda o dia em que
--     membros_select for ampliada (ex.: BPO enxergar vários restaurantes).
--     FIX: qualificar com `convites.restaurante_id` pra religar o membership
--     ao restaurante do convite (a intenção original da 034/A3).
--
--  B1 [BAIXO] confirmar_nfe não filtra o tenant do item
--     O loop de confirmar_nfe (035) seleciona nfe_itens só por
--     nota_fiscal_id + status, sem exigir restaurante_id = v_restaurante_id.
--     Na prática a nota já é validada por tenant no topo, mas o filtro
--     explícito no item é defesa-em-profundidade barata contra itens órfãos
--     de outro tenant colados na mesma nota. FIX: adiciona
--     `AND restaurante_id = v_restaurante_id` no SELECT do loop. Resto da
--     função (conversão de unidade — crítica) preservado IDÊNTICO à 035.
--
--  M1 [MÉDIO] send_feedback aceita destinatários de outro tenant
--     A RPC (011, SECURITY DEFINER) insere feedback_recipients direto de
--     p_recipients, sem validar que cada UUID é membro do restaurante ativo.
--     Como é SECURITY DEFINER, o INSERT ignora a RLS de feedback_recipients
--     → é possível endereçar feedback a usuário de outro tenant (vazamento
--     de mensagem cross-tenant, já que a leitura do destinatário usa a
--     membership dele). FIX: antes do INSERT, rejeita se algum destinatário
--     não for membro de v_restaurant_id. Assinatura, SECURITY DEFINER e
--     search_path preservados.
-- =============================================================

BEGIN;

-- ── A1. convites_insert: religa o membership ao restaurante do convite ──
DROP POLICY IF EXISTS "convites_insert" ON public.convites;
CREATE POLICY "convites_insert" ON public.convites
    FOR INSERT
    WITH CHECK (
        restaurante_id = get_my_restaurant_id()
        AND EXISTS (
            SELECT 1 FROM public.membros m
            WHERE m.usuario_id = auth.uid()
              AND m.restaurante_id = convites.restaurante_id
              AND m.perfil IN ('dono', 'bpo')
        )
    );

-- ── B1. confirmar_nfe: filtra o item pelo tenant (defesa em profundidade) ──
-- Recriação IDÊNTICA à 035; única mudança = `AND restaurante_id = v_restaurante_id`
-- no SELECT do loop. A lógica de conversão de unidade (nfe_fator_conversao)
-- é preservada byte a byte.
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
          AND restaurante_id = v_restaurante_id
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

-- ── M1. send_feedback: valida que todo destinatário é do tenant ─────────
-- Recriação IDÊNTICA à 011; única mudança = validação de membership dos
-- p_recipients ANTES do INSERT em feedback_recipients.
CREATE OR REPLACE FUNCTION public.send_feedback(
    p_tipo      text,
    p_titulo    text,
    p_mensagem  text,
    p_recipients uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_restaurant_id uuid := get_my_restaurant_id();
    v_user_id       uuid := auth.uid();
    v_feedback_id   uuid;
BEGIN
    IF v_restaurant_id IS NULL THEN
        RAISE EXCEPTION 'Usuário sem restaurante';
    END IF;

    IF array_length(p_recipients, 1) IS NULL THEN
        RAISE EXCEPTION 'Pelo menos um destinatário é obrigatório';
    END IF;

    -- Rejeita destinatário que não seja membro do restaurante ativo
    -- (SECURITY DEFINER ignora a RLS de feedback_recipients — a checagem
    -- de tenant tem que ser explícita aqui).
    IF EXISTS (
        SELECT 1
        FROM unnest(p_recipients) AS rid
        WHERE NOT EXISTS (
            SELECT 1 FROM public.membros m
            WHERE m.usuario_id = rid
              AND m.restaurante_id = v_restaurant_id
        )
    ) THEN
        RAISE EXCEPTION 'Destinatário fora do restaurante'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.feedbacks (restaurant_id, autor_id, tipo, titulo, mensagem)
    VALUES (v_restaurant_id, v_user_id, p_tipo, p_titulo, p_mensagem)
    RETURNING id INTO v_feedback_id;

    INSERT INTO public.feedback_recipients (feedback_id, usuario_id)
    SELECT v_feedback_id, unnest(p_recipients)
    ON CONFLICT DO NOTHING;

    RETURN v_feedback_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_feedback(text, text, text, uuid[]) TO authenticated;

COMMIT;
