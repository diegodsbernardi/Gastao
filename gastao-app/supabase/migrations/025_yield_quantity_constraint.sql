-- =============================================================
-- Migration 025 — Trava de yield_quantity (drift de migration)
--
-- PROBLEMA (auditoria M5):
--   000 criou recipes.yield_quantity nullable. 004/006 tentaram
--   ADD COLUMN IF NOT EXISTS ... NOT NULL DEFAULT 1 CHECK (>0), mas como a
--   coluna já existia, foram no-op: NOT NULL, DEFAULT e CHECK nunca vigoraram.
--   Resultado: yield_quantity podia ser NULL ou <= 0 → divisão por zero/NaN
--   no custo por porção.
--
-- FIX: backfill defensivo + default + NOT NULL + CHECK (> 0).
-- =============================================================

BEGIN;

UPDATE public.recipes
SET yield_quantity = 1
WHERE yield_quantity IS NULL OR yield_quantity <= 0;

ALTER TABLE public.recipes ALTER COLUMN yield_quantity SET DEFAULT 1;
ALTER TABLE public.recipes ALTER COLUMN yield_quantity SET NOT NULL;

ALTER TABLE public.recipes DROP CONSTRAINT IF EXISTS recipes_yield_quantity_positivo;
ALTER TABLE public.recipes
    ADD CONSTRAINT recipes_yield_quantity_positivo CHECK (yield_quantity > 0);

COMMIT;
