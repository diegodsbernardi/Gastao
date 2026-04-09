-- =============================================================
-- Gastão — Migration 005: Colunas ausentes
-- Resolve: "Could not find the 'category' column of 'recipes'"
-- Execute no Supabase SQL Editor
-- =============================================================

-- 1. Coluna category em recipes (usada em Preparos e Fichas Finais)
ALTER TABLE public.recipes
ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'Geral';

-- 2. Garante use_in_recipes em ingredients (pode ter ficado pra trás)
ALTER TABLE public.ingredients
ADD COLUMN IF NOT EXISTS use_in_recipes boolean NOT NULL DEFAULT true;

-- 3. Força o PostgREST a recarregar o schema cache
NOTIFY pgrst, 'reload schema';
