-- =============================================================
-- Migration 032 — Painel BPO (Marco 4): membership ativa + criar restaurante
--
-- 1. get_my_membership() corrigida: hoje ordena por criado_em LIMIT 1 e
--    IGNORA restaurante_ativo_id — depois de um switch_restaurante() o
--    front dessincroniza do RLS. Nova versão segue get_my_restaurant_id()
--    (que prioriza o ativo com validação de membership, 021) e ganha os
--    campos de white-label do BPO. Colunas antigas mantidas (retrocompatível).
-- 2. get_my_memberships() ganha brand_color (dot de cor no dropdown).
-- 3. criar_restaurante_bpo(): BPO cria restaurante novo já com membership
--    pra equipe inteira do BPO e switch embutido.
-- =============================================================

BEGIN;

-- ── 1. get_my_membership() alinhada ao restaurante ATIVO ────────────
DROP FUNCTION IF EXISTS public.get_my_membership();
CREATE OR REPLACE FUNCTION public.get_my_membership()
RETURNS TABLE(
    membro_id        uuid,
    restaurante_id   uuid,
    restaurante_nome text,
    perfil           text,
    brand_color      text,
    logo_url         text,
    bpo_id           uuid,
    bpo_nome         text,
    bpo_cor          text,
    bpo_logo         text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
        SELECT
            m.id              AS membro_id,
            m.restaurante_id,
            r.nome            AS restaurante_nome,
            m.perfil,
            r.brand_color,
            r.logo_url,
            r.bpo_id,
            b.nome            AS bpo_nome,
            b.cor_primaria    AS bpo_cor,
            b.logo_url        AS bpo_logo
        FROM public.membros m
        JOIN public.restaurantes r ON r.id = m.restaurante_id
        LEFT JOIN public.bpos b ON b.id = r.bpo_id
        WHERE m.usuario_id = auth.uid()
          AND m.restaurante_id = public.get_my_restaurant_id()
        LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_membership() TO authenticated;

-- ── 2. get_my_memberships() + brand_color ───────────────────────────
DROP FUNCTION IF EXISTS public.get_my_memberships();
CREATE OR REPLACE FUNCTION public.get_my_memberships()
RETURNS TABLE(
    membro_id        uuid,
    restaurante_id   uuid,
    restaurante_nome text,
    bpo_id           uuid,
    bpo_nome         text,
    perfil           text,
    eh_ativo         boolean,
    brand_color      text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ativo_id uuid;
BEGIN
    v_ativo_id := public.get_my_restaurant_id();

    RETURN QUERY
        SELECT
            m.id                                AS membro_id,
            m.restaurante_id,
            r.nome                              AS restaurante_nome,
            r.bpo_id,
            b.nome                              AS bpo_nome,
            m.perfil,
            (v_ativo_id IS NOT NULL AND v_ativo_id = m.restaurante_id) AS eh_ativo,
            r.brand_color
        FROM public.membros m
        JOIN public.restaurantes r ON r.id = m.restaurante_id
        LEFT JOIN public.bpos b ON b.id = r.bpo_id
        WHERE m.usuario_id = auth.uid()
        ORDER BY r.nome;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_memberships() TO authenticated;

-- ── 3. criar_restaurante_bpo() — onboarding assistido ───────────────
CREATE OR REPLACE FUNCTION public.criar_restaurante_bpo(p_nome text, p_cnpj text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_bpo_id uuid;
    v_novo   uuid;
BEGIN
    IF COALESCE(trim(p_nome), '') = '' THEN
        RAISE EXCEPTION 'Nome do restaurante é obrigatório';
    END IF;

    -- O chamador precisa ser membro 'bpo' de algum restaurante com bpo_id
    SELECT r.bpo_id INTO v_bpo_id
    FROM public.membros m
    JOIN public.restaurantes r ON r.id = m.restaurante_id
    WHERE m.usuario_id = auth.uid()
      AND m.perfil = 'bpo'
      AND r.bpo_id IS NOT NULL
    LIMIT 1;

    IF v_bpo_id IS NULL THEN
        RAISE EXCEPTION 'Apenas usuários BPO podem criar restaurantes'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.restaurantes (nome, cnpj, bpo_id)
    VALUES (trim(p_nome), NULLIF(regexp_replace(COALESCE(p_cnpj, ''), '\D', '', 'g'), ''), v_bpo_id)
    RETURNING id INTO v_novo;

    -- Toda a equipe do BPO ganha membership no restaurante novo
    INSERT INTO public.membros (usuario_id, restaurante_id, perfil)
    SELECT DISTINCT m.usuario_id, v_novo, 'bpo'
    FROM public.membros m
    JOIN public.restaurantes r ON r.id = m.restaurante_id
    WHERE r.bpo_id = v_bpo_id
      AND m.perfil = 'bpo'
    ON CONFLICT DO NOTHING;

    -- Switch embutido (a membership acima já existe → trigger guard da 021 ok)
    UPDATE public.profiles
    SET restaurante_ativo_id = v_novo
    WHERE id = auth.uid();

    RETURN v_novo;
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_restaurante_bpo(text, text) TO authenticated;

COMMIT;
