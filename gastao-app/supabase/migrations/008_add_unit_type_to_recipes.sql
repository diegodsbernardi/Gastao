-- =============================================================
-- Gastão — Migration 008: Adiciona unit_type à tabela recipes
-- Resolve: BUG-2 — "Unidade de saída" nunca era persistida nos preparos
-- Execute no Supabase SQL Editor
-- =============================================================

ALTER TABLE public.recipes
ADD COLUMN IF NOT EXISTS unit_type text NOT NULL DEFAULT 'un';

-- Força o PostgREST a recarregar o schema cache
NOTIFY pgrst, 'reload schema';
