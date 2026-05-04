-- =============================================================
-- 016 — recipe_categories
-- Categorias governadas para preparos e fichas (análogo a
-- ingredient_categories). Antes, `recipes.category` era texto livre
-- e o frontend usava lista hardcoded; agora o usuário pode cadastrar
-- categorias próprias (ou importá-las via Planilha-Mãe).
-- =============================================================

CREATE TABLE IF NOT EXISTS public.recipe_categories (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id   uuid NOT NULL REFERENCES public.restaurantes(id) ON DELETE CASCADE,
    name            text NOT NULL,
    recipe_tipo     text NOT NULL CHECK (recipe_tipo IN ('preparo', 'ficha')),
    created_at      timestamptz DEFAULT now(),
    CONSTRAINT recipe_categories_restaurant_tipo_name_key UNIQUE (restaurant_id, recipe_tipo, name)
);

CREATE INDEX IF NOT EXISTS idx_recipe_categories_restaurant_tipo
    ON public.recipe_categories (restaurant_id, recipe_tipo);

ALTER TABLE public.recipe_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rec_cats_select" ON public.recipe_categories;
CREATE POLICY "rec_cats_select" ON public.recipe_categories
    FOR SELECT USING (restaurant_id = get_my_restaurant_id());

DROP POLICY IF EXISTS "rec_cats_insert" ON public.recipe_categories;
CREATE POLICY "rec_cats_insert" ON public.recipe_categories
    FOR INSERT WITH CHECK (restaurant_id = get_my_restaurant_id());

DROP POLICY IF EXISTS "rec_cats_delete" ON public.recipe_categories;
CREATE POLICY "rec_cats_delete" ON public.recipe_categories
    FOR DELETE USING (restaurant_id = get_my_restaurant_id());
