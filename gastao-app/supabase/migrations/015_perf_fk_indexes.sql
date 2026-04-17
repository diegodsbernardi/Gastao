-- =============================================================
-- Gastão — Migration 015: Índices em Foreign Keys
-- Execute no Supabase SQL Editor (Dashboard → SQL Editor)
-- Pré-requisitos: 000..014 já executadas.
--
-- Postgres NÃO cria índice automático em foreign keys. Sem esses
-- índices, cada DELETE/UPDATE em recipes faz Full Table Scan em
-- recipe_ingredients, sales, etc — em volume real, trava o banco.
--
-- Esta migration só adiciona índices, é segura de rodar a qualquer
-- momento e não muda comportamento (apenas performance).
-- =============================================================

-- recipe_ingredients: FK pra recipes (CASCADE) e ingredients
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe_id
    ON public.recipe_ingredients(recipe_id);

CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_ingredient_id
    ON public.recipe_ingredients(ingredient_id)
    WHERE ingredient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_sub_recipe_id
    ON public.recipe_ingredients(sub_recipe_id)
    WHERE sub_recipe_id IS NOT NULL;

-- sales: FK pra recipes (CASCADE)
CREATE INDEX IF NOT EXISTS idx_sales_recipe_id
    ON public.sales(recipe_id);

-- profiles: FK pra restaurantes
CREATE INDEX IF NOT EXISTS idx_profiles_restaurant_id
    ON public.profiles(restaurant_id)
    WHERE restaurant_id IS NOT NULL;

-- convites: lookup por email (AuthContext) e por restaurante
CREATE INDEX IF NOT EXISTS idx_convites_restaurante_status
    ON public.convites(restaurante_id, status);

CREATE INDEX IF NOT EXISTS idx_convites_email_lower_pendente
    ON public.convites(LOWER(email))
    WHERE status = 'pendente';

-- nfe_itens: FK pra restaurantes (CASCADE)
CREATE INDEX IF NOT EXISTS idx_nfe_itens_restaurante
    ON public.nfe_itens(restaurante_id);

-- feedbacks: FK pra autor
CREATE INDEX IF NOT EXISTS idx_feedbacks_autor
    ON public.feedbacks(autor_id);

-- =============================================================
-- Fim 015_perf_fk_indexes.sql
-- =============================================================
