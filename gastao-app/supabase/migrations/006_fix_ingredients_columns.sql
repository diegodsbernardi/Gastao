-- =============================================================
-- TOCS CRM — Migration 006: Fix colunas da tabela ingredients
-- Resolve: "Could not find the 'avg_cost_per_unit' column"
-- Execute no Supabase SQL Editor
-- =============================================================

-- Garante todas as colunas necessárias em ingredients
ALTER TABLE public.ingredients
ADD COLUMN IF NOT EXISTS avg_cost_per_unit numeric  NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS stock_quantity    numeric  NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS unit_type         text     NOT NULL DEFAULT 'kg',
ADD COLUMN IF NOT EXISTS use_in_recipes    boolean  NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS tipo              text     NOT NULL DEFAULT 'insumo_base'
    CHECK (tipo IN ('insumo_base', 'insumo_direto'));

-- Garante colunas em recipes também
ALTER TABLE public.recipes
ADD COLUMN IF NOT EXISTS tipo           text    NOT NULL DEFAULT 'ficha_final'
    CHECK (tipo IN ('preparo', 'ficha_final')),
ADD COLUMN IF NOT EXISTS yield_quantity numeric NOT NULL DEFAULT 1
    CHECK (yield_quantity > 0),
ADD COLUMN IF NOT EXISTS category       text    NOT NULL DEFAULT 'Geral';

-- Força o PostgREST a recarregar o schema cache
NOTIFY pgrst, 'reload schema';
