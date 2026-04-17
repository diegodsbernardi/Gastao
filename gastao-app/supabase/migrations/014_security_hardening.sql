-- =============================================================
-- Gastão — Migration 014: Security Hardening (Tenant Hijack)
-- Execute no Supabase SQL Editor (Dashboard → SQL Editor)
-- Pré-requisitos: 000..013 já executadas.
--
-- Fecha brecha de "tenant hijack" nas tabelas membros e
-- restaurantes. A policy antiga permitia INSERT direto via REST
-- quando o usuário ainda não tinha restaurante — qualquer um
-- conseguia se enfiar como dono em outro tenant. Agora o INSERT
-- direto é proibido; toda criação passa pelas RPCs SECURITY
-- DEFINER (create_restaurant, accept_invite), que já validam
-- autoria pelo auth.uid().
--
-- Também adiciona RPC reject_invite — completa o fluxo de convite
-- explícito (o auto-accept no AuthContext foi removido).
-- =============================================================

-- ============================================================
-- 1. Fecha INSERT direto em restaurantes
--    A única forma legítima é via RPC create_restaurant (SECURITY
--    DEFINER), que bypassa RLS porque roda como owner.
-- ============================================================
DROP POLICY IF EXISTS "restaurantes_insert" ON public.restaurantes;
CREATE POLICY "restaurantes_insert" ON public.restaurantes
    FOR INSERT WITH CHECK (false);

-- ============================================================
-- 2. Fecha INSERT direto em membros
--    Antes: permitia restaurante_id = qualquer-coisa quando o
--    usuário ainda não tinha vínculo (get_my_restaurant_id() IS
--    NULL) — vetor de tenant hijack. Agora bloqueado; criação
--    de membros passa só pelas RPCs SECURITY DEFINER:
--      - create_restaurant (auto-adiciona criador como dono)
--      - accept_invite     (valida convite pelo email)
-- ============================================================
DROP POLICY IF EXISTS "membros_insert" ON public.membros;
CREATE POLICY "membros_insert" ON public.membros
    FOR INSERT WITH CHECK (false);

-- ============================================================
-- 3. RPC: reject_invite
--    Permite ao usuário recusar explicitamente um convite
--    pendente endereçado ao seu email. Marca como 'expirado'
--    (status já existente no CHECK).
-- ============================================================
CREATE OR REPLACE FUNCTION public.reject_invite(p_convite_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email text := auth.email();
BEGIN
    UPDATE public.convites
    SET status = 'expirado'
    WHERE id = p_convite_id
      AND LOWER(email) = LOWER(v_email)
      AND status = 'pendente';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Convite não encontrado ou já utilizado';
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_invite(uuid) TO authenticated;

-- =============================================================
-- Fim 014_security_hardening.sql
-- =============================================================
