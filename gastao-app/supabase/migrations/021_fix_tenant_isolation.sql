-- =============================================================
-- Migration 021 — Fix crítico: isolamento multi-tenant
--
-- PROBLEMA (confirmado por exploit):
--   A policy `profiles_own` (FOR ALL, WITH CHECK id = auth.uid()) permite
--   que qualquer usuário autenticado faça PATCH direto em
--   `profiles.restaurante_ativo_id` apontando pro restaurante de OUTRO
--   cliente. Como `get_my_restaurant_id()` prioriza esse campo sem validar
--   membership, o atacante ganha CRUD completo (ingredients, recipes,
--   sales, nfe...) do tenant-vítima. A RPC `switch_restaurante` valida
--   membership, mas era inútil porque dava pra escrever a coluna direto.
--
-- FIX (defesa em profundidade, 2 camadas):
--   1. `get_my_restaurant_id()` só honra `restaurante_ativo_id` se existir
--      membership correspondente. Sem membership, ignora o campo forjado e
--      cai no fallback legítimo (primeiro membership real).
--   2. Trigger BEFORE UPDATE em `profiles` impede que o cliente altere
--      `restaurante_ativo_id` para um restaurante sem membership — a troca
--      legítima continua fluindo pela RPC `switch_restaurante` (SECURITY
--      DEFINER, que valida). Fecha o vetor na origem, não só no consumo.
-- =============================================================

BEGIN;

-- ── 1. get_my_restaurant_id() com validação de membership ──────────
CREATE OR REPLACE FUNCTION public.get_my_restaurant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    -- 1º: restaurante ativo — SÓ se houver membership correspondente
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
    -- 2º: primeiro membership (user normal com 1 só, comportamento legado)
    (SELECT restaurante_id FROM public.membros
       WHERE usuario_id = auth.uid() LIMIT 1),
    -- 3º: profile.restaurant_id (fallback pre-membros)
    (SELECT restaurant_id FROM public.profiles WHERE id = auth.uid() LIMIT 1)
  );
$$;

-- ── 2. Trigger: bloqueia troca direta de restaurante_ativo_id ──────
-- Só permite setar/trocar o ativo para um restaurante em que o usuário
-- tem membership. A RPC switch_restaurante já valida, mas o trigger
-- fecha também o PATCH REST direto (o vetor do exploit).
CREATE OR REPLACE FUNCTION public.guard_restaurante_ativo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.restaurante_ativo_id IS DISTINCT FROM OLD.restaurante_ativo_id
       AND NEW.restaurante_ativo_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.membros m
            WHERE m.usuario_id = NEW.id
              AND m.restaurante_id = NEW.restaurante_ativo_id
        ) THEN
            RAISE EXCEPTION 'Sem membership no restaurante % — troca negada', NEW.restaurante_ativo_id
                USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_restaurante_ativo ON public.profiles;
CREATE TRIGGER trg_guard_restaurante_ativo
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_restaurante_ativo();

-- ── 3. Sanidade: zera ativos órfãos já persistidos (do exploit/testes) ─
-- Qualquer restaurante_ativo_id sem membership correspondente é limpo.
UPDATE public.profiles p
SET restaurante_ativo_id = NULL
WHERE p.restaurante_ativo_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.membros m
    WHERE m.usuario_id = p.id
      AND m.restaurante_id = p.restaurante_ativo_id
  );

COMMIT;
