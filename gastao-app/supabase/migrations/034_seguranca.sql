-- =============================================================
-- Migration 034 — Hardening de segurança (auditoria 2026-07-08)
--
-- Fecha 4 brechas encontradas na auditoria de segurança:
--
--  A1+A2 [CRÍTICO] Takeover de tenant via profiles.restaurant_id
--     A 021 fechou o vetor de `restaurante_ativo_id` (trigger + membership
--     no fallback #1 do get_my_restaurant_id), mas deixou a coluna IRMÃ
--     `restaurant_id` totalmente aberta:
--       • A policy profiles_own (FOR ALL, WITH CHECK id=auth.uid()) permite
--         PATCH REST direto em profiles.restaurant_id.
--       • O fallback #3 de get_my_restaurant_id lê restaurant_id SEM checar
--         membership.
--     Exploit: conta nova (sem membros, ativo NULL) faz
--       PATCH /profiles?id=eq.<meu_uid> {"restaurant_id":"<uuid_vítima>"}
--     → fallback #1 pula (ativo NULL), #2 pula (zero membros), #3 devolve o
--       restaurante da vítima → CRUD completo do tenant alheio.
--     FIX (defesa em 2 camadas, igual à 021):
--       1. Trigger BEFORE UPDATE bloqueia troca de restaurant_id sem
--          membership correspondente (fecha a escrita na origem).
--       2. Fallback #3 de get_my_restaurant_id passa a exigir membership.
--     Os RPCs legítimos (create_restaurant, accept_invite,
--     criar_restaurante_bpo) inserem `membros` ANTES do UPDATE do profile,
--     então o membership já existe quando o trigger roda → não quebram.
--
--  A3 [MÉDIO] Escalada de papel via INSERT direto em convites
--     A policy convites_insert só exige restaurante_id = get_my_restaurant_id(),
--     sem checar perfil ("controle feito na app"). Um funcionário insere via
--     REST um convite perfil='gerente'/'bpo'. Passa a exigir que o chamador
--     seja 'dono' ou 'bpo' do restaurante (igual ao canInvite do front).
--
--  A4 [BAIXO] salvar_composicao não valida refs cross-tenant
--     A RPC valida a receita-pai mas insere ingredient_id/sub_recipe_id do
--     JSON do cliente sem checar que pertencem ao restaurante ativo. Passa a
--     validar cada referência.
-- =============================================================

BEGIN;

-- ── A1. Trigger: bloqueia troca direta de restaurant_id E ativo ────────
-- Substitui o guard da 021 por um que cobre AS DUAS colunas de tenant.
CREATE OR REPLACE FUNCTION public.guard_profiles_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- restaurante_ativo_id (vetor da 021)
    IF NEW.restaurante_ativo_id IS DISTINCT FROM OLD.restaurante_ativo_id
       AND NEW.restaurante_ativo_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.membros m
            WHERE m.usuario_id = NEW.id
              AND m.restaurante_id = NEW.restaurante_ativo_id
        ) THEN
            RAISE EXCEPTION 'Sem membership no restaurante % — troca de ativo negada', NEW.restaurante_ativo_id
                USING ERRCODE = '42501';
        END IF;
    END IF;

    -- restaurant_id (coluna irmã, deixada aberta pela 021)
    IF NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
       AND NEW.restaurant_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.membros m
            WHERE m.usuario_id = NEW.id
              AND m.restaurante_id = NEW.restaurant_id
        ) THEN
            RAISE EXCEPTION 'Sem membership no restaurante % — troca negada', NEW.restaurant_id
                USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- Repoint do trigger (remove o antigo da 021, aponta pro novo)
DROP TRIGGER IF EXISTS trg_guard_restaurante_ativo ON public.profiles;
DROP TRIGGER IF EXISTS trg_guard_profiles_tenant ON public.profiles;
CREATE TRIGGER trg_guard_profiles_tenant
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_profiles_tenant();

-- ── A2. get_my_restaurant_id() — fallback #3 com membership ─────────────
CREATE OR REPLACE FUNCTION public.get_my_restaurant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    -- 1º: restaurante ativo — só se houver membership correspondente
    (SELECT p.restaurante_ativo_id
       FROM public.profiles p
       WHERE p.id = auth.uid()
         AND p.restaurante_ativo_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM public.membros m
           WHERE m.usuario_id = auth.uid()
             AND m.restaurante_id = p.restaurante_ativo_id
         )
       LIMIT 1),
    -- 2º: primeiro membership (user normal com 1 só)
    (SELECT restaurante_id FROM public.membros
       WHERE usuario_id = auth.uid() LIMIT 1),
    -- 3º: profile.restaurant_id legado — SÓ se houver membership
    (SELECT p.restaurant_id
       FROM public.profiles p
       WHERE p.id = auth.uid()
         AND p.restaurant_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM public.membros m
           WHERE m.usuario_id = auth.uid()
             AND m.restaurante_id = p.restaurant_id
         )
       LIMIT 1)
  );
$$;

-- ── A2b. Sanidade: zera restaurant_id órfão já persistido (do exploit) ──
UPDATE public.profiles p
SET restaurant_id = NULL
WHERE p.restaurant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.membros m
    WHERE m.usuario_id = p.id
      AND m.restaurante_id = p.restaurant_id
  );

-- ── A3. convites: só dono/bpo podem convidar ───────────────────────────
DROP POLICY IF EXISTS "convites_insert" ON public.convites;
CREATE POLICY "convites_insert" ON public.convites
    FOR INSERT
    WITH CHECK (
        restaurante_id = get_my_restaurant_id()
        AND EXISTS (
            SELECT 1 FROM public.membros m
            WHERE m.usuario_id = auth.uid()
              AND m.restaurante_id = restaurante_id
              AND m.perfil IN ('dono', 'bpo')
        )
    );

-- ── A4. salvar_composicao: valida refs cross-tenant ────────────────────
CREATE OR REPLACE FUNCTION public.salvar_composicao(
    p_recipe_id uuid,
    p_ri        jsonb DEFAULT '[]'::jsonb,
    p_rsr       jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_restaurante uuid;
    v_recipe_rest uuid;
BEGIN
    v_restaurante := public.get_my_restaurant_id();
    IF v_restaurante IS NULL THEN
        RAISE EXCEPTION 'Sem restaurante ativo';
    END IF;

    SELECT restaurant_id INTO v_recipe_rest FROM public.recipes WHERE id = p_recipe_id;
    IF v_recipe_rest IS NULL OR v_recipe_rest <> v_restaurante THEN
        RAISE EXCEPTION 'Receita não pertence ao restaurante ativo';
    END IF;

    -- Valida que todo ingredient_id referenciado é do tenant
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(p_ri, '[]'::jsonb)) e
        WHERE NULLIF(e->>'ingredient_id', '') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.ingredients i
            WHERE i.id = (e->>'ingredient_id')::uuid
              AND i.restaurant_id = v_restaurante
          )
    ) THEN
        RAISE EXCEPTION 'Insumo referenciado não pertence ao restaurante ativo'
            USING ERRCODE = '42501';
    END IF;

    -- Valida que todo sub_recipe_id referenciado (em p_ri e p_rsr) é do tenant
    IF EXISTS (
        SELECT 1
        FROM (
            SELECT NULLIF(e->>'sub_recipe_id', '') AS srid
            FROM jsonb_array_elements(COALESCE(p_ri, '[]'::jsonb)) e
            UNION ALL
            SELECT NULLIF(e->>'sub_recipe_id', '')
            FROM jsonb_array_elements(COALESCE(p_rsr, '[]'::jsonb)) e
        ) refs
        WHERE refs.srid IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.recipes r
            WHERE r.id = refs.srid::uuid
              AND r.restaurant_id = v_restaurante
          )
    ) THEN
        RAISE EXCEPTION 'Sub-receita referenciada não pertence ao restaurante ativo'
            USING ERRCODE = '42501';
    END IF;

    -- Limpa composição atual
    DELETE FROM public.recipe_ingredients WHERE recipe_id = p_recipe_id;
    DELETE FROM public.recipe_sub_recipes WHERE recipe_id = p_recipe_id;

    -- Reinsere recipe_ingredients (insumos e/ou sub-preparos no modelo do Preparos)
    INSERT INTO public.recipe_ingredients (recipe_id, ingredient_id, sub_recipe_id, quantity_needed)
    SELECT p_recipe_id,
           NULLIF(e->>'ingredient_id', '')::uuid,
           NULLIF(e->>'sub_recipe_id', '')::uuid,
           (e->>'quantity_needed')::numeric
    FROM jsonb_array_elements(COALESCE(p_ri, '[]'::jsonb)) e;

    -- Reinsere recipe_sub_recipes (modelo do Recipes)
    INSERT INTO public.recipe_sub_recipes (recipe_id, sub_recipe_id, quantity_needed)
    SELECT p_recipe_id,
           (e->>'sub_recipe_id')::uuid,
           (e->>'quantity_needed')::numeric
    FROM jsonb_array_elements(COALESCE(p_rsr, '[]'::jsonb)) e;
END;
$$;

GRANT EXECUTE ON FUNCTION public.salvar_composicao(uuid, jsonb, jsonb) TO authenticated;

COMMIT;
