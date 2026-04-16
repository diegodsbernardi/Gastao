-- =============================================================
-- Gastão — Migration 013: Aproveitamento de Insumos
-- Fator de aproveitamento (0-1). Ex: abacaxi 53% = 0.53
-- Custo líquido = avg_cost_per_unit / aproveitamento
-- =============================================================

ALTER TABLE public.ingredients
ADD COLUMN IF NOT EXISTS aproveitamento numeric NOT NULL DEFAULT 1
    CHECK (aproveitamento > 0 AND aproveitamento <= 1);

COMMENT ON COLUMN public.ingredients.aproveitamento IS
    'Fator de aproveitamento (0-1). 1 = 100% aproveitado. 0.53 = 53%. Custo líquido = avg_cost / aproveitamento';
