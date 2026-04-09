-- =============================================================
-- TOCS CRM — Migration 007: RLS policies para ingredients,
-- recipes, recipe_ingredients
-- Resolve: "new row violates row-level security policy"
-- Execute no Supabase SQL Editor
-- =============================================================

-- ── ingredients ──────────────────────────────────────────────
DROP POLICY IF EXISTS "ing_select" ON public.ingredients;
DROP POLICY IF EXISTS "ing_insert" ON public.ingredients;
DROP POLICY IF EXISTS "ing_update" ON public.ingredients;
DROP POLICY IF EXISTS "ing_delete" ON public.ingredients;

CREATE POLICY "ing_select" ON public.ingredients
    FOR SELECT USING (restaurant_id = get_my_restaurant_id());

CREATE POLICY "ing_insert" ON public.ingredients
    FOR INSERT WITH CHECK (restaurant_id = get_my_restaurant_id());

CREATE POLICY "ing_update" ON public.ingredients
    FOR UPDATE USING (restaurant_id = get_my_restaurant_id());

CREATE POLICY "ing_delete" ON public.ingredients
    FOR DELETE USING (restaurant_id = get_my_restaurant_id());

-- ── recipes ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "rec_select" ON public.recipes;
DROP POLICY IF EXISTS "rec_insert" ON public.recipes;
DROP POLICY IF EXISTS "rec_update" ON public.recipes;
DROP POLICY IF EXISTS "rec_delete" ON public.recipes;

CREATE POLICY "rec_select" ON public.recipes
    FOR SELECT USING (restaurant_id = get_my_restaurant_id());

CREATE POLICY "rec_insert" ON public.recipes
    FOR INSERT WITH CHECK (restaurant_id = get_my_restaurant_id());

CREATE POLICY "rec_update" ON public.recipes
    FOR UPDATE USING (restaurant_id = get_my_restaurant_id());

CREATE POLICY "rec_delete" ON public.recipes
    FOR DELETE USING (restaurant_id = get_my_restaurant_id());

-- ── recipe_ingredients ────────────────────────────────────────
DROP POLICY IF EXISTS "ri_select" ON public.recipe_ingredients;
DROP POLICY IF EXISTS "ri_insert" ON public.recipe_ingredients;
DROP POLICY IF EXISTS "ri_update" ON public.recipe_ingredients;
DROP POLICY IF EXISTS "ri_delete" ON public.recipe_ingredients;

CREATE POLICY "ri_select" ON public.recipe_ingredients
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.recipes r
            WHERE r.id = recipe_ingredients.recipe_id
              AND r.restaurant_id = get_my_restaurant_id()
        )
    );

CREATE POLICY "ri_insert" ON public.recipe_ingredients
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.recipes r
            WHERE r.id = recipe_ingredients.recipe_id
              AND r.restaurant_id = get_my_restaurant_id()
        )
    );

CREATE POLICY "ri_update" ON public.recipe_ingredients
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.recipes r
            WHERE r.id = recipe_ingredients.recipe_id
              AND r.restaurant_id = get_my_restaurant_id()
        )
    );

CREATE POLICY "ri_delete" ON public.recipe_ingredients
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.recipes r
            WHERE r.id = recipe_ingredients.recipe_id
              AND r.restaurant_id = get_my_restaurant_id()
        )
    );

NOTIFY pgrst, 'reload schema';
