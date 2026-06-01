-- =============================================================
-- Migration 017 — BPO multi-restaurante (Marco 4)
--
-- Implementa o painel BPO (Cinco) que opera N restaurantes via switch
-- de contexto. Princípios:
--   • Cada BPO vira linha em `bpos` (white-label leve).
--   • `restaurantes.bpo_id` opcional aponta pro BPO operador (ou NULL).
--   • `profiles.restaurante_ativo_id` guarda qual restaurante o user
--     está vendo agora (post-it no perfil).
--   • `get_my_restaurant_id()` prioriza o ativo → fallback pra primeiro
--     membership → fallback pro legado profiles.restaurant_id.
--   • Usuários BPO têm N memberships (perfil='bpo'), um por restaurante
--     do BPO. RLS continua escopo por restaurante_id — switch troca o
--     escopo, nunca bypassa.
--
-- RETROCOMPATIBILIDADE:
--   • Users normais (dono/gerente/funcionario) com 1 membership só:
--     restaurante_ativo_id fica NULL, fallback pega o membership único,
--     comportamento idêntico ao pré-017.
--   • Nenhuma policy existente foi alterada.
-- =============================================================

BEGIN;

-- ── 1. TABELA bpos ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bpos (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome           text NOT NULL,
    cnpj           text,
    logo_url       text,
    cor_primaria   text,           -- ex: '#FF6B35'
    criado_em      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bpos ENABLE ROW LEVEL SECURITY;

-- Qualquer usuário autenticado pode SELECT no próprio BPO
-- (membership em algum restaurante do BPO basta).
CREATE POLICY "bpos_select_meu" ON public.bpos
    FOR SELECT TO authenticated
    USING (
        id IN (
            SELECT DISTINCT r.bpo_id
            FROM public.restaurantes r
            JOIN public.membros m ON m.restaurante_id = r.id
            WHERE m.usuario_id = auth.uid() AND r.bpo_id IS NOT NULL
        )
    );

-- ── 2. restaurantes.bpo_id ─────────────────────────────────────────
ALTER TABLE public.restaurantes
    ADD COLUMN IF NOT EXISTS bpo_id uuid REFERENCES public.bpos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_restaurantes_bpo_id ON public.restaurantes(bpo_id)
    WHERE bpo_id IS NOT NULL;

-- ── 3. profiles.restaurante_ativo_id ───────────────────────────────
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS restaurante_ativo_id uuid
        REFERENCES public.restaurantes(id) ON DELETE SET NULL;

-- ── 4. Aceitar perfil 'bpo' em convites e membros ──────────────────
ALTER TABLE public.convites
    DROP CONSTRAINT IF EXISTS convites_perfil_check;
ALTER TABLE public.convites
    ADD CONSTRAINT convites_perfil_check
    CHECK (perfil IN ('gerente', 'funcionario', 'bpo'));

-- membros não tinha CHECK explícito antes (vimos no 001_equipe.sql).
-- Adiciona pra firmar contrato.
ALTER TABLE public.membros
    DROP CONSTRAINT IF EXISTS membros_perfil_check;
ALTER TABLE public.membros
    ADD CONSTRAINT membros_perfil_check
    CHECK (perfil IN ('dono', 'gerente', 'funcionario', 'bpo'));

-- ── 5. get_my_restaurant_id() reescrita com prioridade ─────────────
-- Nova ordem: profiles.restaurante_ativo_id → membros → profiles.restaurant_id legado
CREATE OR REPLACE FUNCTION public.get_my_restaurant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    -- 1º: restaurante ativo escolhido (BPO ou switch deliberado)
    (SELECT restaurante_ativo_id FROM public.profiles
       WHERE id = auth.uid() AND restaurante_ativo_id IS NOT NULL LIMIT 1),
    -- 2º: primeiro membership (user normal com 1 só, comportamento legado)
    (SELECT restaurante_id FROM public.membros
       WHERE usuario_id = auth.uid() LIMIT 1),
    -- 3º: profile.restaurant_id (fallback pre-membros)
    (SELECT restaurant_id FROM public.profiles WHERE id = auth.uid() LIMIT 1)
  );
$$;

-- ── 6. get_my_memberships() plural — todas as memberships do usuário ─
-- Frontend BPO usa essa pra montar o dropdown de switch.
CREATE OR REPLACE FUNCTION public.get_my_memberships()
RETURNS TABLE(
    membro_id        uuid,
    restaurante_id   uuid,
    restaurante_nome text,
    bpo_id           uuid,
    bpo_nome         text,
    perfil           text,
    eh_ativo         boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ativo_id uuid;
BEGIN
    SELECT restaurante_ativo_id INTO v_ativo_id
    FROM public.profiles WHERE id = auth.uid();

    RETURN QUERY
        SELECT
            m.id                                AS membro_id,
            m.restaurante_id,
            r.nome                              AS restaurante_nome,
            r.bpo_id,
            b.nome                              AS bpo_nome,
            m.perfil,
            (v_ativo_id IS NOT NULL AND v_ativo_id = m.restaurante_id) AS eh_ativo
        FROM public.membros m
        JOIN public.restaurantes r ON r.id = m.restaurante_id
        LEFT JOIN public.bpos b ON b.id = r.bpo_id
        WHERE m.usuario_id = auth.uid()
        ORDER BY r.nome;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_memberships() TO authenticated;

-- ── 7. switch_restaurante(uuid) — troca o restaurante ativo ────────
-- Valida que o usuário tem membership no restaurante alvo. Sem isso,
-- raise exception (não confia em input do cliente).
CREATE OR REPLACE FUNCTION public.switch_restaurante(p_restaurante_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tem_membership boolean;
BEGIN
    -- Verifica membership
    SELECT EXISTS (
        SELECT 1 FROM public.membros
        WHERE usuario_id = auth.uid()
          AND restaurante_id = p_restaurante_id
    ) INTO v_tem_membership;

    IF NOT v_tem_membership THEN
        RAISE EXCEPTION 'Usuário não tem membership no restaurante %', p_restaurante_id
            USING ERRCODE = '42501';  -- insufficient_privilege
    END IF;

    -- Atualiza profile
    UPDATE public.profiles
    SET restaurante_ativo_id = p_restaurante_id
    WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.switch_restaurante(uuid) TO authenticated;

-- ── 8. Sanity check ────────────────────────────────────────────────
-- Confirma estado pós-migração — esperado:
--   bpos: 0 (vai inserir Cinco no Sprint 2)
--   bpo_id em restaurantes: existe coluna
--   restaurante_ativo_id em profiles: existe coluna
DO $$
DECLARE
    v_count int;
BEGIN
    SELECT count(*) INTO v_count
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'restaurantes'
      AND column_name = 'bpo_id';
    IF v_count = 0 THEN
        RAISE EXCEPTION 'Migration 017 falhou: coluna bpo_id não existe em restaurantes';
    END IF;

    SELECT count(*) INTO v_count
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'restaurante_ativo_id';
    IF v_count = 0 THEN
        RAISE EXCEPTION 'Migration 017 falhou: coluna restaurante_ativo_id não existe em profiles';
    END IF;
END $$;

COMMIT;
