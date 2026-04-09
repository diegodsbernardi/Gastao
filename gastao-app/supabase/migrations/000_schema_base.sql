-- =============================================================
-- Gastão — Sessão 1: Schema base (multi-tenant + domínio core)
-- Execute no Supabase SQL Editor (Dashboard → SQL Editor)
-- Esta é a primeira migration. Rode antes de 001..011.
--
-- Cria as tabelas e funções base que o resto das migrations
-- assume como pré-requisito:
--   - restaurantes, profiles, membros (multi-tenant)
--   - ingredients, ingredient_categories
--   - recipes, recipe_ingredients
--   - sales
--   - get_my_restaurant_id()
--   - handle_new_user() trigger em auth.users
--
-- Extraído do schema TOCS em 2026-04-09. Inclui correção de
-- drift na tabela sales (sold_at/total_value/unit_price) — o
-- código do gastao-app espera essas colunas.
-- =============================================================

-- =====================
-- 1. RESTAURANTES (tenant raiz)
-- =====================
CREATE TABLE IF NOT EXISTS public.restaurantes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome        text NOT NULL,
    cnpj        text,
    plano       text NOT NULL DEFAULT 'beta'
                    CHECK (plano IN ('beta', 'starter', 'pro', 'enterprise')),
    criado_em   timestamptz NOT NULL DEFAULT now()
);

-- (brand_color e logo_url são adicionados na migration 004)

-- =====================
-- 2. PROFILES (1:1 com auth.users)
-- =====================
CREATE TABLE IF NOT EXISTS public.profiles (
    id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    restaurant_id uuid REFERENCES public.restaurantes(id) ON DELETE SET NULL,
    role          text,
    name          text
);

-- =====================
-- 3. MEMBROS (N:N usuário↔restaurante com perfil)
-- =====================
CREATE TABLE IF NOT EXISTS public.membros (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    restaurante_id  uuid NOT NULL REFERENCES public.restaurantes(id) ON DELETE CASCADE,
    perfil          text NOT NULL DEFAULT 'funcionario'
                        CHECK (perfil IN ('dono', 'gerente', 'funcionario')),
    criado_em       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT membros_usuario_restaurante_unique UNIQUE (usuario_id, restaurante_id)
);

CREATE INDEX IF NOT EXISTS membros_usuario_id_idx     ON public.membros (usuario_id);
CREATE INDEX IF NOT EXISTS membros_restaurante_id_idx ON public.membros (restaurante_id);

-- =====================
-- 4. HELPER: get_my_restaurant_id()
-- Resolve o restaurante do usuário logado, primeiro via membros
-- (caminho moderno) e fallback via profiles (compatibilidade).
-- Toda RLS de domínio depende dessa função.
-- =====================
CREATE OR REPLACE FUNCTION public.get_my_restaurant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT restaurante_id FROM public.membros  WHERE usuario_id = auth.uid() LIMIT 1),
    (SELECT restaurant_id  FROM public.profiles WHERE id          = auth.uid() LIMIT 1)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_my_restaurant_id() TO authenticated;

-- =====================
-- 5. TRIGGER: handle_new_user
-- Cria automaticamente uma linha em profiles quando o Auth
-- cria um usuário novo. Necessário pra o fluxo de signup.
-- =====================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id)
    VALUES (NEW.id)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================
-- 6. INGREDIENT CATEGORIES
-- =====================
CREATE TABLE IF NOT EXISTS public.ingredient_categories (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id   uuid NOT NULL REFERENCES public.restaurantes(id) ON DELETE CASCADE,
    name            text NOT NULL,
    ingredient_tipo text NOT NULL DEFAULT 'insumo_base',
    CONSTRAINT ingredient_categories_restaurant_id_name_key UNIQUE (restaurant_id, name)
);

-- =====================
-- 7. INGREDIENTS (insumos)
-- tipo: insumo_base | insumo_direto | embalagem
-- =====================
CREATE TABLE IF NOT EXISTS public.ingredients (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id      uuid NOT NULL REFERENCES public.restaurantes(id) ON DELETE CASCADE,
    name               text NOT NULL,
    tipo               text NOT NULL
                            CHECK (tipo IN ('insumo_base', 'insumo_direto', 'embalagem')),
    unit               text,
    unit_type          text NOT NULL DEFAULT 'kg',
    cost_per_unit      numeric(10,4) DEFAULT 0,
    avg_cost_per_unit  numeric NOT NULL DEFAULT 0,
    stock_quantity     numeric NOT NULL DEFAULT 0,
    use_in_recipes     boolean NOT NULL DEFAULT true,
    categoria          text,
    created_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingredients_tipo ON public.ingredients (restaurant_id, tipo);

-- =====================
-- 8. RECIPES (preparos + fichas finais — schema 3 camadas)
-- =====================
CREATE TABLE IF NOT EXISTS public.recipes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id   uuid NOT NULL REFERENCES public.restaurantes(id) ON DELETE CASCADE,
    product_name    text NOT NULL,
    tipo            text NOT NULL
                         CHECK (tipo IN ('preparo', 'ficha_final')),
    yield_quantity  numeric,
    yield_unit      text,
    cost_per_unit   numeric(10,4) DEFAULT 0,
    sale_price      numeric(10,2),
    image_url       text,
    category        text NOT NULL DEFAULT 'Geral',
    unit_type       text NOT NULL DEFAULT 'un',
    created_at      timestamptz DEFAULT now()
);

-- =====================
-- 9. RECIPE INGREDIENTS
-- Composição da receita: ou um insumo OU um sub-preparo, nunca os dois.
-- =====================
CREATE TABLE IF NOT EXISTS public.recipe_ingredients (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id       uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
    ingredient_id   uuid REFERENCES public.ingredients(id),
    sub_recipe_id   uuid REFERENCES public.recipes(id),
    quantity_needed numeric NOT NULL,
    unit            text,
    CONSTRAINT must_have_one CHECK (
        (ingredient_id IS NOT NULL AND sub_recipe_id IS NULL)
        OR
        (ingredient_id IS NULL AND sub_recipe_id IS NOT NULL)
    )
);

-- =====================
-- 10. SALES
-- ATENÇÃO: o código do gastao-app (Dashboard.tsx, Sales.tsx) lê
-- as colunas sold_at, unit_price e total_value. O TOCS legado só
-- tinha sale_date e quantity_sold — esta migration corrige o drift.
-- =====================
CREATE TABLE IF NOT EXISTS public.sales (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id uuid NOT NULL REFERENCES public.restaurantes(id) ON DELETE CASCADE,
    recipe_id     uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
    quantity_sold numeric(10,2) NOT NULL,
    unit_price    numeric(10,2) NOT NULL DEFAULT 0,
    total_value   numeric(10,2) NOT NULL DEFAULT 0,
    sold_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_restaurant_sold_at ON public.sales (restaurant_id, sold_at DESC);

-- =====================
-- 11. RLS — habilita em tudo
-- Políticas concretas vivem nesta e nas próximas migrations.
-- =====================
ALTER TABLE public.restaurantes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membros               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredient_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredients           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_ingredients    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales                 ENABLE ROW LEVEL SECURITY;

-- ----- profiles: cada um vê e edita o próprio
DROP POLICY IF EXISTS "profiles_own" ON public.profiles;
CREATE POLICY "profiles_own" ON public.profiles
    FOR ALL USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- ----- restaurantes: vê quem é membro; só dono altera/deleta; qualquer um cria
DROP POLICY IF EXISTS "restaurantes_select" ON public.restaurantes;
CREATE POLICY "restaurantes_select" ON public.restaurantes
    FOR SELECT USING (
        id IN (SELECT restaurante_id FROM public.membros WHERE usuario_id = auth.uid())
    );

DROP POLICY IF EXISTS "restaurantes_insert" ON public.restaurantes;
CREATE POLICY "restaurantes_insert" ON public.restaurantes
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "restaurantes_update" ON public.restaurantes;
CREATE POLICY "restaurantes_update" ON public.restaurantes
    FOR UPDATE USING (
        id IN (SELECT restaurante_id FROM public.membros
               WHERE usuario_id = auth.uid() AND perfil = 'dono')
    );

DROP POLICY IF EXISTS "restaurantes_delete" ON public.restaurantes;
CREATE POLICY "restaurantes_delete" ON public.restaurantes
    FOR DELETE USING (
        id IN (SELECT restaurante_id FROM public.membros
               WHERE usuario_id = auth.uid() AND perfil = 'dono')
    );

-- ----- membros: vê do próprio restaurante; só dono gerencia
DROP POLICY IF EXISTS "membros_select" ON public.membros;
CREATE POLICY "membros_select" ON public.membros
    FOR SELECT USING (restaurante_id = get_my_restaurant_id());

DROP POLICY IF EXISTS "membros_insert" ON public.membros;
CREATE POLICY "membros_insert" ON public.membros
    FOR INSERT WITH CHECK (
        restaurante_id = get_my_restaurant_id() OR get_my_restaurant_id() IS NULL
    );

DROP POLICY IF EXISTS "membros_update" ON public.membros;
CREATE POLICY "membros_update" ON public.membros
    FOR UPDATE USING (
        restaurante_id IN (SELECT restaurante_id FROM public.membros
                           WHERE usuario_id = auth.uid() AND perfil = 'dono')
    );

DROP POLICY IF EXISTS "membros_delete" ON public.membros;
CREATE POLICY "membros_delete" ON public.membros
    FOR DELETE USING (
        restaurante_id IN (SELECT restaurante_id FROM public.membros
                           WHERE usuario_id = auth.uid() AND perfil = 'dono')
    );

-- ----- ingredient_categories
DROP POLICY IF EXISTS "cats_select" ON public.ingredient_categories;
CREATE POLICY "cats_select" ON public.ingredient_categories
    FOR SELECT USING (restaurant_id = get_my_restaurant_id());
DROP POLICY IF EXISTS "cats_insert" ON public.ingredient_categories;
CREATE POLICY "cats_insert" ON public.ingredient_categories
    FOR INSERT WITH CHECK (restaurant_id = get_my_restaurant_id());
DROP POLICY IF EXISTS "cats_delete" ON public.ingredient_categories;
CREATE POLICY "cats_delete" ON public.ingredient_categories
    FOR DELETE USING (restaurant_id = get_my_restaurant_id());

-- ----- ingredients
DROP POLICY IF EXISTS "ing_select" ON public.ingredients;
CREATE POLICY "ing_select" ON public.ingredients
    FOR SELECT USING (restaurant_id = get_my_restaurant_id());
DROP POLICY IF EXISTS "ing_insert" ON public.ingredients;
CREATE POLICY "ing_insert" ON public.ingredients
    FOR INSERT WITH CHECK (restaurant_id = get_my_restaurant_id());
DROP POLICY IF EXISTS "ing_update" ON public.ingredients;
CREATE POLICY "ing_update" ON public.ingredients
    FOR UPDATE USING (restaurant_id = get_my_restaurant_id());
DROP POLICY IF EXISTS "ing_delete" ON public.ingredients;
CREATE POLICY "ing_delete" ON public.ingredients
    FOR DELETE USING (restaurant_id = get_my_restaurant_id());

-- ----- recipes
DROP POLICY IF EXISTS "rec_select" ON public.recipes;
CREATE POLICY "rec_select" ON public.recipes
    FOR SELECT USING (restaurant_id = get_my_restaurant_id());
DROP POLICY IF EXISTS "rec_insert" ON public.recipes;
CREATE POLICY "rec_insert" ON public.recipes
    FOR INSERT WITH CHECK (restaurant_id = get_my_restaurant_id());
DROP POLICY IF EXISTS "rec_update" ON public.recipes;
CREATE POLICY "rec_update" ON public.recipes
    FOR UPDATE USING (restaurant_id = get_my_restaurant_id());
DROP POLICY IF EXISTS "rec_delete" ON public.recipes;
CREATE POLICY "rec_delete" ON public.recipes
    FOR DELETE USING (restaurant_id = get_my_restaurant_id());

-- ----- recipe_ingredients (autoriza pelo restaurante da receita pai)
DROP POLICY IF EXISTS "ri_select" ON public.recipe_ingredients;
CREATE POLICY "ri_select" ON public.recipe_ingredients
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM public.recipes r
        WHERE r.id = recipe_ingredients.recipe_id
          AND r.restaurant_id = get_my_restaurant_id()
    ));
DROP POLICY IF EXISTS "ri_insert" ON public.recipe_ingredients;
CREATE POLICY "ri_insert" ON public.recipe_ingredients
    FOR INSERT WITH CHECK (EXISTS (
        SELECT 1 FROM public.recipes r
        WHERE r.id = recipe_ingredients.recipe_id
          AND r.restaurant_id = get_my_restaurant_id()
    ));
DROP POLICY IF EXISTS "ri_update" ON public.recipe_ingredients;
CREATE POLICY "ri_update" ON public.recipe_ingredients
    FOR UPDATE USING (EXISTS (
        SELECT 1 FROM public.recipes r
        WHERE r.id = recipe_ingredients.recipe_id
          AND r.restaurant_id = get_my_restaurant_id()
    ));
DROP POLICY IF EXISTS "ri_delete" ON public.recipe_ingredients;
CREATE POLICY "ri_delete" ON public.recipe_ingredients
    FOR DELETE USING (EXISTS (
        SELECT 1 FROM public.recipes r
        WHERE r.id = recipe_ingredients.recipe_id
          AND r.restaurant_id = get_my_restaurant_id()
    ));

-- ----- sales
DROP POLICY IF EXISTS "sales_select" ON public.sales;
CREATE POLICY "sales_select" ON public.sales
    FOR SELECT USING (restaurant_id = get_my_restaurant_id());
DROP POLICY IF EXISTS "sales_insert" ON public.sales;
CREATE POLICY "sales_insert" ON public.sales
    FOR INSERT WITH CHECK (restaurant_id = get_my_restaurant_id());
DROP POLICY IF EXISTS "sales_update" ON public.sales;
CREATE POLICY "sales_update" ON public.sales
    FOR UPDATE USING (restaurant_id = get_my_restaurant_id());
DROP POLICY IF EXISTS "sales_delete" ON public.sales;
CREATE POLICY "sales_delete" ON public.sales
    FOR DELETE USING (restaurant_id = get_my_restaurant_id());

-- =============================================================
-- Fim 000_schema_base.sql — agora rode 001_equipe.sql
-- =============================================================
