-- =============================================================
-- Gastão — Sessão 11: Feedbacks
-- Execute no Supabase SQL Editor (Dashboard → SQL Editor)
-- Pré-requisitos: migrations 001..010
-- =============================================================
--
-- Modelo simples:
--   feedbacks       → mensagem do dono/gerente para 1 ou N funcionários
--   feedback_reads  → quem já visualizou (para "lido/não lido")
--
-- Regras:
--   - Dono/gerente podem criar feedbacks para qualquer membro do restaurante
--   - Funcionário vê só os feedbacks direcionados a ele
--   - Marcar como lido = upsert em feedback_reads
-- =============================================================

-- ============================================================
-- 1. FEEDBACKS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.feedbacks (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  uuid        NOT NULL REFERENCES public.restaurantes(id) ON DELETE CASCADE,
    autor_id       uuid        NOT NULL REFERENCES auth.users(id),
    /* Tipo orienta a UI: elogio = verde, orientacao = amarelo, alerta = vermelho */
    tipo           text        NOT NULL DEFAULT 'orientacao'
                                CHECK (tipo IN ('elogio', 'orientacao', 'alerta')),
    titulo         text        NOT NULL,
    mensagem       text        NOT NULL,
    criado_em      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feedbacks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fb_select" ON public.feedbacks;
DROP POLICY IF EXISTS "fb_insert" ON public.feedbacks;
DROP POLICY IF EXISTS "fb_delete" ON public.feedbacks;

-- Qualquer membro do restaurante vê os feedbacks dele (via destinatários)
-- ou, se for dono/gerente, vê tudo do restaurante
CREATE POLICY "fb_select" ON public.feedbacks
    FOR SELECT USING (restaurant_id = get_my_restaurant_id());

CREATE POLICY "fb_insert" ON public.feedbacks
    FOR INSERT WITH CHECK (
        restaurant_id = get_my_restaurant_id()
        AND autor_id = auth.uid()
    );

CREATE POLICY "fb_delete" ON public.feedbacks
    FOR DELETE USING (
        restaurant_id = get_my_restaurant_id()
        AND autor_id = auth.uid()
    );

CREATE INDEX IF NOT EXISTS idx_fb_restaurant_data
    ON public.feedbacks(restaurant_id, criado_em DESC);

-- ============================================================
-- 2. DESTINATÁRIOS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.feedback_recipients (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    feedback_id  uuid        NOT NULL REFERENCES public.feedbacks(id) ON DELETE CASCADE,
    usuario_id   uuid        NOT NULL REFERENCES auth.users(id),
    UNIQUE (feedback_id, usuario_id)
);

ALTER TABLE public.feedback_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fbr_select" ON public.feedback_recipients;
DROP POLICY IF EXISTS "fbr_insert" ON public.feedback_recipients;

CREATE POLICY "fbr_select" ON public.feedback_recipients
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.feedbacks f
            WHERE f.id = feedback_recipients.feedback_id
              AND f.restaurant_id = get_my_restaurant_id()
        )
    );

CREATE POLICY "fbr_insert" ON public.feedback_recipients
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.feedbacks f
            WHERE f.id = feedback_recipients.feedback_id
              AND f.restaurant_id = get_my_restaurant_id()
              AND f.autor_id = auth.uid()
        )
    );

CREATE INDEX IF NOT EXISTS idx_fbr_usuario
    ON public.feedback_recipients(usuario_id);

-- ============================================================
-- 3. LEITURAS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.feedback_reads (
    feedback_id uuid        NOT NULL REFERENCES public.feedbacks(id) ON DELETE CASCADE,
    usuario_id  uuid        NOT NULL REFERENCES auth.users(id),
    lido_em     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (feedback_id, usuario_id)
);

ALTER TABLE public.feedback_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fbread_select" ON public.feedback_reads;
DROP POLICY IF EXISTS "fbread_insert" ON public.feedback_reads;

CREATE POLICY "fbread_select" ON public.feedback_reads
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.feedbacks f
            WHERE f.id = feedback_reads.feedback_id
              AND f.restaurant_id = get_my_restaurant_id()
        )
    );

-- Só pode marcar leitura em feedback endereçado a si mesmo
CREATE POLICY "fbread_insert" ON public.feedback_reads
    FOR INSERT WITH CHECK (
        usuario_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.feedback_recipients r
            WHERE r.feedback_id = feedback_reads.feedback_id
              AND r.usuario_id  = auth.uid()
        )
    );

-- ============================================================
-- 4. RPC: send_feedback
-- Cria feedback + destinatários em uma transação
-- ============================================================
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

-- ============================================================
-- 5. RPC: get_my_feedbacks
-- Lista feedbacks direcionados ao usuário logado + estado de leitura
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_feedbacks()
RETURNS TABLE(
    id          uuid,
    tipo        text,
    titulo      text,
    mensagem    text,
    criado_em   timestamptz,
    autor_nome  text,
    lido        boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
BEGIN
    RETURN QUERY
        SELECT
            f.id,
            f.tipo,
            f.titulo,
            f.mensagem,
            f.criado_em,
            COALESCE(
                au.raw_user_meta_data->>'full_name',
                split_part(au.email, '@', 1)
            )::text AS autor_nome,
            (r.feedback_id IS NOT NULL) AS lido
        FROM public.feedbacks f
        JOIN public.feedback_recipients fr ON fr.feedback_id = f.id
        JOIN auth.users au ON au.id = f.autor_id
        LEFT JOIN public.feedback_reads r
               ON r.feedback_id = f.id AND r.usuario_id = v_user_id
        WHERE fr.usuario_id = v_user_id
        ORDER BY f.criado_em DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_feedbacks() TO authenticated;

-- ============================================================
-- 6. RPC: get_sent_feedbacks
-- Lista feedbacks enviados pelo usuário logado (dono/gerente)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_sent_feedbacks()
RETURNS TABLE(
    id               uuid,
    tipo             text,
    titulo           text,
    mensagem         text,
    criado_em        timestamptz,
    total_recipients integer,
    total_reads      integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
        SELECT
            f.id,
            f.tipo,
            f.titulo,
            f.mensagem,
            f.criado_em,
            (SELECT COUNT(*)::int FROM public.feedback_recipients fr WHERE fr.feedback_id = f.id),
            (SELECT COUNT(*)::int FROM public.feedback_reads r WHERE r.feedback_id = f.id)
        FROM public.feedbacks f
        WHERE f.autor_id = auth.uid()
          AND f.restaurant_id = get_my_restaurant_id()
        ORDER BY f.criado_em DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sent_feedbacks() TO authenticated;

-- ============================================================
-- 7. RPC: mark_feedback_read
-- Idempotente — pode chamar múltiplas vezes
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_feedback_read(p_feedback_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.feedback_reads (feedback_id, usuario_id)
    VALUES (p_feedback_id, auth.uid())
    ON CONFLICT DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_feedback_read(uuid) TO authenticated;
