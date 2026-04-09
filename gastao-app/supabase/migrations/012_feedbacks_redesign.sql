-- =============================================================
-- Gastão — Sessão 12: Redesign de Feedbacks
-- Execute no Supabase SQL Editor (Dashboard → SQL Editor)
-- Pré-requisitos: migrations 000..011 (a 011 é DESTRUÍDA aqui)
-- =============================================================
--
-- O modelo antigo (mensagem do dono → 1..N funcionários, com
-- "lido/não lido") foi substituído por uma FICHA ESTRUTURADA de
-- avaliação 1:1, registrando uma conversa que aconteceu:
--
--   - período avaliado (inicio + fim)
--   - pontos positivos
--   - pontos de melhoria
--   - plano de ação
--   - próximo encontro
--   - "ciente" do funcionário (data da assinatura digital)
--
-- Campos audio_url e transcricao reservados pra fluxo futuro de
-- gravação + transcrição via IA.
-- =============================================================

-- ============================================================
-- 1. DROP do modelo antigo (drop CASCADE para tirar políticas/FKs)
-- ============================================================
DROP FUNCTION IF EXISTS public.send_feedback(text, text, text, uuid[]);
DROP FUNCTION IF EXISTS public.get_my_feedbacks();
DROP FUNCTION IF EXISTS public.get_sent_feedbacks();
DROP FUNCTION IF EXISTS public.mark_feedback_read(uuid);

DROP TABLE IF EXISTS public.feedback_reads      CASCADE;
DROP TABLE IF EXISTS public.feedback_recipients CASCADE;
DROP TABLE IF EXISTS public.feedbacks           CASCADE;

-- ============================================================
-- 2. NOVA TABELA feedbacks (ficha estruturada 1:1)
-- ============================================================
CREATE TABLE public.feedbacks (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id     uuid        NOT NULL REFERENCES public.restaurantes(id) ON DELETE CASCADE,
    funcionario_id    uuid        NOT NULL REFERENCES auth.users(id),
    autor_id          uuid        NOT NULL REFERENCES auth.users(id),

    periodo_inicio    date        NOT NULL,
    periodo_fim       date        NOT NULL,

    pontos_positivos  text        NOT NULL DEFAULT '',
    pontos_melhoria   text        NOT NULL DEFAULT '',
    plano_acao        text        NOT NULL DEFAULT '',
    proximo_encontro  date,

    acknowledged_at   timestamptz,

    -- Reservados pra fluxo futuro de gravação + transcrição IA
    audio_url         text,
    transcricao       text,

    criado_em         timestamptz NOT NULL DEFAULT now(),
    atualizado_em     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT periodo_valido CHECK (periodo_fim >= periodo_inicio)
);

CREATE INDEX idx_feedbacks_restaurant_data
    ON public.feedbacks (restaurant_id, criado_em DESC);
CREATE INDEX idx_feedbacks_funcionario
    ON public.feedbacks (funcionario_id, criado_em DESC);

-- Trigger pra manter atualizado_em
CREATE OR REPLACE FUNCTION public.feedbacks_touch_atualizado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.atualizado_em := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS feedbacks_touch_atualizado_trg ON public.feedbacks;
CREATE TRIGGER feedbacks_touch_atualizado_trg
    BEFORE UPDATE ON public.feedbacks
    FOR EACH ROW EXECUTE FUNCTION public.feedbacks_touch_atualizado();

-- ============================================================
-- 3. RLS
-- ============================================================
ALTER TABLE public.feedbacks ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer membro do restaurante pode ler. As RPCs filtram
-- além disso (funcionário só vê os próprios). A política só garante
-- que ninguém vê dados de outro tenant.
DROP POLICY IF EXISTS "fb_select" ON public.feedbacks;
CREATE POLICY "fb_select" ON public.feedbacks
    FOR SELECT USING (restaurant_id = get_my_restaurant_id());

-- INSERT: o autor tem que ser o usuário logado e o restaurante
-- tem que ser o do usuário. Não bloqueamos por perfil aqui — a app
-- esconde criação pra funcionário.
DROP POLICY IF EXISTS "fb_insert" ON public.feedbacks;
CREATE POLICY "fb_insert" ON public.feedbacks
    FOR INSERT WITH CHECK (
        restaurant_id = get_my_restaurant_id()
        AND autor_id   = auth.uid()
    );

-- UPDATE: autor (pra editar a ficha) OU funcionário avaliado (pra dar ack)
DROP POLICY IF EXISTS "fb_update" ON public.feedbacks;
CREATE POLICY "fb_update" ON public.feedbacks
    FOR UPDATE USING (
        restaurant_id = get_my_restaurant_id()
        AND (autor_id = auth.uid() OR funcionario_id = auth.uid())
    );

-- DELETE: só o autor
DROP POLICY IF EXISTS "fb_delete" ON public.feedbacks;
CREATE POLICY "fb_delete" ON public.feedbacks
    FOR DELETE USING (
        restaurant_id = get_my_restaurant_id()
        AND autor_id   = auth.uid()
    );

-- ============================================================
-- 4. RPC: create_feedback
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_feedback(
    p_funcionario_id   uuid,
    p_periodo_inicio   date,
    p_periodo_fim      date,
    p_pontos_positivos text DEFAULT '',
    p_pontos_melhoria  text DEFAULT '',
    p_plano_acao       text DEFAULT '',
    p_proximo_encontro date DEFAULT NULL
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

    -- Funcionário avaliado precisa ser membro do mesmo restaurante
    IF NOT EXISTS (
        SELECT 1 FROM public.membros
        WHERE usuario_id = p_funcionario_id
          AND restaurante_id = v_restaurant_id
    ) THEN
        RAISE EXCEPTION 'Funcionário não é membro do restaurante';
    END IF;

    INSERT INTO public.feedbacks (
        restaurant_id, funcionario_id, autor_id,
        periodo_inicio, periodo_fim,
        pontos_positivos, pontos_melhoria, plano_acao, proximo_encontro
    )
    VALUES (
        v_restaurant_id, p_funcionario_id, v_user_id,
        p_periodo_inicio, p_periodo_fim,
        COALESCE(p_pontos_positivos, ''),
        COALESCE(p_pontos_melhoria, ''),
        COALESCE(p_plano_acao, ''),
        p_proximo_encontro
    )
    RETURNING id INTO v_feedback_id;

    RETURN v_feedback_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_feedback(uuid, date, date, text, text, text, date) TO authenticated;

-- ============================================================
-- 5. RPC: update_feedback
-- Só o autor pode editar, e só enquanto não foi acknowledged.
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_feedback(
    p_id               uuid,
    p_periodo_inicio   date,
    p_periodo_fim      date,
    p_pontos_positivos text DEFAULT '',
    p_pontos_melhoria  text DEFAULT '',
    p_plano_acao       text DEFAULT '',
    p_proximo_encontro date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_row     public.feedbacks%ROWTYPE;
BEGIN
    SELECT * INTO v_row
    FROM public.feedbacks
    WHERE id = p_id
      AND restaurant_id = get_my_restaurant_id();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Feedback não encontrado';
    END IF;

    IF v_row.autor_id <> v_user_id THEN
        RAISE EXCEPTION 'Só o autor pode editar';
    END IF;

    IF v_row.acknowledged_at IS NOT NULL THEN
        RAISE EXCEPTION 'Feedback já foi confirmado pelo funcionário e não pode mais ser editado';
    END IF;

    UPDATE public.feedbacks
    SET periodo_inicio   = p_periodo_inicio,
        periodo_fim      = p_periodo_fim,
        pontos_positivos = COALESCE(p_pontos_positivos, ''),
        pontos_melhoria  = COALESCE(p_pontos_melhoria, ''),
        plano_acao       = COALESCE(p_plano_acao, ''),
        proximo_encontro = p_proximo_encontro
    WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_feedback(uuid, date, date, text, text, text, date) TO authenticated;

-- ============================================================
-- 6. RPC: acknowledge_feedback
-- Funcionário marca "ciente" (assinatura digital).
-- ============================================================
CREATE OR REPLACE FUNCTION public.acknowledge_feedback(p_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_row     public.feedbacks%ROWTYPE;
    v_now     timestamptz := now();
BEGIN
    SELECT * INTO v_row
    FROM public.feedbacks
    WHERE id = p_id
      AND restaurant_id = get_my_restaurant_id();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Feedback não encontrado';
    END IF;

    IF v_row.funcionario_id <> v_user_id THEN
        RAISE EXCEPTION 'Só o funcionário avaliado pode marcar como ciente';
    END IF;

    IF v_row.acknowledged_at IS NOT NULL THEN
        RETURN v_row.acknowledged_at;
    END IF;

    UPDATE public.feedbacks
    SET acknowledged_at = v_now
    WHERE id = p_id;

    RETURN v_now;
END;
$$;

GRANT EXECUTE ON FUNCTION public.acknowledge_feedback(uuid) TO authenticated;

-- ============================================================
-- 7. RPC: delete_feedback
-- Só o autor, só enquanto não foi acknowledged.
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_feedback(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_row     public.feedbacks%ROWTYPE;
BEGIN
    SELECT * INTO v_row
    FROM public.feedbacks
    WHERE id = p_id
      AND restaurant_id = get_my_restaurant_id();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Feedback não encontrado';
    END IF;

    IF v_row.autor_id <> v_user_id THEN
        RAISE EXCEPTION 'Só o autor pode deletar';
    END IF;

    IF v_row.acknowledged_at IS NOT NULL THEN
        RAISE EXCEPTION 'Feedback já foi confirmado e não pode ser deletado';
    END IF;

    DELETE FROM public.feedbacks WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_feedback(uuid) TO authenticated;

-- ============================================================
-- 8. RPC: list_feedbacks
-- Retorna todas as fichas que o usuário pode ver:
--   - Se for funcionário: as próprias (onde funcionario_id = ele)
--   - Se for dono/gerente: todas do restaurante
-- Vem com nomes denormalizados pra UI não precisar de joins.
-- ============================================================
CREATE OR REPLACE FUNCTION public.list_feedbacks()
RETURNS TABLE(
    id                uuid,
    funcionario_id    uuid,
    funcionario_nome  text,
    funcionario_email text,
    autor_id          uuid,
    autor_nome        text,
    periodo_inicio    date,
    periodo_fim       date,
    pontos_positivos  text,
    pontos_melhoria   text,
    plano_acao        text,
    proximo_encontro  date,
    acknowledged_at   timestamptz,
    criado_em         timestamptz,
    atualizado_em     timestamptz,
    sou_autor         boolean,
    sou_funcionario   boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id       uuid := auth.uid();
    v_restaurant_id uuid := get_my_restaurant_id();
    v_perfil        text;
BEGIN
    IF v_restaurant_id IS NULL THEN
        RETURN;
    END IF;

    SELECT m.perfil INTO v_perfil
    FROM public.membros m
    WHERE m.usuario_id = v_user_id
      AND m.restaurante_id = v_restaurant_id
    LIMIT 1;

    RETURN QUERY
        SELECT
            f.id,
            f.funcionario_id,
            COALESCE(uf.raw_user_meta_data->>'full_name', split_part(uf.email, '@', 1))::text AS funcionario_nome,
            uf.email::text AS funcionario_email,
            f.autor_id,
            COALESCE(ua.raw_user_meta_data->>'full_name', split_part(ua.email, '@', 1))::text AS autor_nome,
            f.periodo_inicio,
            f.periodo_fim,
            f.pontos_positivos,
            f.pontos_melhoria,
            f.plano_acao,
            f.proximo_encontro,
            f.acknowledged_at,
            f.criado_em,
            f.atualizado_em,
            (f.autor_id       = v_user_id) AS sou_autor,
            (f.funcionario_id = v_user_id) AS sou_funcionario
        FROM public.feedbacks f
        JOIN auth.users uf ON uf.id = f.funcionario_id
        JOIN auth.users ua ON ua.id = f.autor_id
        WHERE f.restaurant_id = v_restaurant_id
          AND (
              v_perfil IN ('dono', 'gerente')
              OR f.funcionario_id = v_user_id
          )
        ORDER BY f.criado_em DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_feedbacks() TO authenticated;

-- =============================================================
-- Fim 012_feedbacks_redesign.sql
-- =============================================================
