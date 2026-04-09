-- Adiciona coluna para controlar se o insumo aparece na composição de fichas técnicas
-- Default TRUE: todos os insumos existentes continuam disponíveis
ALTER TABLE public.ingredients
ADD COLUMN IF NOT EXISTS use_in_recipes boolean NOT NULL DEFAULT true;
