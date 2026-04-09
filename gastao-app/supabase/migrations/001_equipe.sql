-- =============================================================
-- Gastão — Sessão 2: Equipe & Onboarding
-- Execute no Supabase SQL Editor (Dashboard → SQL Editor)
-- Pré-requisitos: restaurantes, membros, profiles e
--   get_my_restaurant_id() já existem do setup da Sessão 1.
-- =============================================================

-- =====================
-- 1. TABELA CONVITES
-- =====================
CREATE TABLE IF NOT EXISTS public.convites (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurante_id uuid NOT NULL REFERENCES public.restaurantes(id) ON DELETE CASCADE,
    email          text NOT NULL,
    perfil         text NOT NULL DEFAULT 'funcionario'
                       CHECK (perfil IN ('gerente', 'funcionario')),
    status         text NOT NULL DEFAULT 'pendente'
                       CHECK (status IN ('pendente', 'aceito', 'expirado')),
    convidado_por  uuid REFERENCES auth.users(id),
    criado_em      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.convites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "convites_select" ON public.convites;
DROP POLICY IF EXISTS "convites_insert" ON public.convites;

-- Membros podem ver convites do próprio restaurante
-- Usuários sem restaurante podem ver convites direcionados ao seu email
CREATE POLICY "convites_select" ON public.convites
    FOR SELECT
    USING (
        restaurante_id = get_my_restaurant_id()
        OR LOWER(email) = LOWER(auth.email())
    );

-- Qualquer membro pode criar convite (controle de perfil feito na app)
CREATE POLICY "convites_insert" ON public.convites
    FOR INSERT
    WITH CHECK (restaurante_id = get_my_restaurant_id());

-- =====================
-- 2. RPC: get_my_membership
-- Retorna dados do membro + restaurante do usuário logado
-- Usado no AuthContext para carregar perfil e restauranteId
-- =====================
CREATE OR REPLACE FUNCTION public.get_my_membership()
RETURNS TABLE(
    membro_id        uuid,
    restaurante_id   uuid,
    restaurante_nome text,
    perfil           text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
        SELECT
            m.id             AS membro_id,
            m.restaurante_id,
            r.nome           AS restaurante_nome,
            m.perfil
        FROM public.membros m
        JOIN public.restaurantes r ON r.id = m.restaurante_id
        WHERE m.usuario_id = auth.uid()
        ORDER BY m.criado_em
        LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_membership() TO authenticated;

-- =====================
-- 3. RPC: create_restaurant
-- Cria restaurante + insere usuário como dono + atualiza profiles
-- Usado na tela de Onboarding
-- =====================
CREATE OR REPLACE FUNCTION public.create_restaurant(
    p_nome text,
    p_cnpj text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_restaurant_id uuid;
    v_user_id       uuid := auth.uid();
BEGIN
    -- Cria restaurante
    INSERT INTO public.restaurantes (nome, cnpj)
    VALUES (p_nome, NULLIF(TRIM(COALESCE(p_cnpj, '')), ''))
    RETURNING id INTO v_restaurant_id;

    -- Adiciona usuário como dono
    INSERT INTO public.membros (usuario_id, restaurante_id, perfil)
    VALUES (v_user_id, v_restaurant_id, 'dono')
    ON CONFLICT DO NOTHING;

    -- Mantém profiles sincronizado para compatibilidade com RLS existente
    UPDATE public.profiles
    SET restaurant_id = v_restaurant_id
    WHERE id = v_user_id;

    RETURN v_restaurant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_restaurant(text, text) TO authenticated;

-- =====================
-- 4. RPC: accept_invite
-- Aceita um convite pendente: cria membro + atualiza profiles
-- Usado no AuthContext quando novo usuário loga pela primeira vez
-- =====================
CREATE OR REPLACE FUNCTION public.accept_invite(p_convite_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_convite public.convites%ROWTYPE;
    v_user_id uuid := auth.uid();
    v_email   text := auth.email();
BEGIN
    SELECT * INTO v_convite
    FROM public.convites
    WHERE id = p_convite_id
      AND LOWER(email) = LOWER(v_email)
      AND status = 'pendente';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Convite não encontrado ou já utilizado';
    END IF;

    INSERT INTO public.membros (usuario_id, restaurante_id, perfil)
    VALUES (v_user_id, v_convite.restaurante_id, v_convite.perfil)
    ON CONFLICT DO NOTHING;

    UPDATE public.profiles
    SET restaurant_id = v_convite.restaurante_id
    WHERE id = v_user_id;

    UPDATE public.convites
    SET status = 'aceito'
    WHERE id = p_convite_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_invite(uuid) TO authenticated;

-- =====================
-- 5. RPC: get_restaurant_members
-- Lista todos os membros do restaurante do usuário logado
-- Faz join com auth.users para pegar email e nome
-- Usado na tela de Equipe
-- =====================
CREATE OR REPLACE FUNCTION public.get_restaurant_members()
RETURNS TABLE(
    id           uuid,
    usuario_id   uuid,
    email        text,
    nome         text,
    perfil       text,
    criado_em    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_restaurante_id uuid;
BEGIN
    v_restaurante_id := get_my_restaurant_id();
    IF v_restaurante_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
        SELECT
            m.id,
            m.usuario_id,
            au.email::text,
            COALESCE(
                au.raw_user_meta_data->>'full_name',
                split_part(au.email, '@', 1)
            )::text AS nome,
            m.perfil,
            m.criado_em
        FROM public.membros m
        JOIN auth.users au ON au.id = m.usuario_id
        WHERE m.restaurante_id = v_restaurante_id
        ORDER BY m.criado_em;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_restaurant_members() TO authenticated;

-- =====================
-- 6. MIGRAÇÃO DE DADOS
-- Para usuários existentes que já têm profiles.restaurant_id mas
-- ainda não têm linha em membros — os torna 'dono' automaticamente.
-- Seguro de rodar mesmo se a tabela membros estiver vazia.
-- =====================
INSERT INTO public.membros (usuario_id, restaurante_id, perfil)
SELECT
    p.id AS usuario_id,
    p.restaurant_id,
    'dono' AS perfil
FROM public.profiles p
WHERE p.restaurant_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM public.membros m
      WHERE m.usuario_id = p.id
  )
ON CONFLICT DO NOTHING;
