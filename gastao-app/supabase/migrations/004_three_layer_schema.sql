-- =============================================================
-- TOCS CRM — Sessão 4: Schema 3 Camadas (Fichas Técnicas)
-- Execute no Supabase SQL Editor (Dashboard → SQL Editor)
-- Pré-requisitos: migrations 001, 002 e 003 já executadas.
-- =============================================================

-- ============================================================
-- 1. COLUNA tipo EM ingredients
--    'insumo_base'   → vem de NF-e, entra em Preparos
--    'insumo_direto' → vai direto na Ficha Final (ex: pão, bebida)
-- ============================================================
ALTER TABLE public.ingredients
ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'insumo_base'
    CHECK (tipo IN ('insumo_base', 'insumo_direto'));

-- Migração de dados: ingredientes com use_in_recipes = false
-- eram itens que NÃO entravam em receitas → vão direto na ficha final
-- (executado apenas se a coluna use_in_recipes existir)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'ingredients'
          AND column_name  = 'use_in_recipes'
    ) THEN
        UPDATE public.ingredients
        SET tipo = 'insumo_direto'
        WHERE use_in_recipes = false;
    END IF;
END;
$$;

-- Índice para filtros frequentes por tipo
CREATE INDEX IF NOT EXISTS idx_ingredients_tipo
    ON public.ingredients(restaurant_id, tipo);

-- ============================================================
-- 2. COLUNA tipo EM recipes
--    'preparo'     → mini-receita / porção padrão (ex: Smash 80g)
--    'ficha_final' → produto vendido (ex: X-Tudo, Combo Simples)
-- ============================================================
ALTER TABLE public.recipes
ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'ficha_final'
    CHECK (tipo IN ('preparo', 'ficha_final'));

-- Todos os registros existentes são fichas finais (produtos vendidos)
-- Nenhuma migração necessária — DEFAULT já cobre.

-- ============================================================
-- 3. COLUNA yield_quantity EM recipes
--    Rendimento do preparo: quantas unidades a receita produz.
--    Ex: "Molho Especial" produz 10 porções → yield_quantity = 10
--    Custo por unidade = custo_total_insumos / yield_quantity
--    Para fichas finais este campo é ignorado (sempre 1).
-- ============================================================
ALTER TABLE public.recipes
ADD COLUMN IF NOT EXISTS yield_quantity numeric NOT NULL DEFAULT 1
    CHECK (yield_quantity > 0);

-- ============================================================
-- 4. TABELA recipe_sub_recipes
--    Liga uma Ficha Final aos Preparos que a compõem.
--    Ex: X-Tudo usa 2x Smash 80g + 1x Molho Especial
-- ============================================================
CREATE TABLE IF NOT EXISTS public.recipe_sub_recipes (
    id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id        uuid    NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
    sub_recipe_id    uuid    NOT NULL REFERENCES public.recipes(id) ON DELETE RESTRICT,
    quantity_needed  numeric NOT NULL CHECK (quantity_needed > 0),
    UNIQUE (recipe_id, sub_recipe_id)
);

ALTER TABLE public.recipe_sub_recipes ENABLE ROW LEVEL SECURITY;

-- RLS: acesso apenas a registros do próprio restaurante
-- (verifica via join com recipes, que já tem restaurant_id)
DROP POLICY IF EXISTS "rsr_select" ON public.recipe_sub_recipes;
DROP POLICY IF EXISTS "rsr_insert" ON public.recipe_sub_recipes;
DROP POLICY IF EXISTS "rsr_update" ON public.recipe_sub_recipes;
DROP POLICY IF EXISTS "rsr_delete" ON public.recipe_sub_recipes;

CREATE POLICY "rsr_select" ON public.recipe_sub_recipes
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.recipes r
            WHERE r.id = recipe_sub_recipes.recipe_id
              AND r.restaurant_id = get_my_restaurant_id()
        )
    );

CREATE POLICY "rsr_insert" ON public.recipe_sub_recipes
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.recipes r
            WHERE r.id = recipe_sub_recipes.recipe_id
              AND r.restaurant_id = get_my_restaurant_id()
        )
    );

CREATE POLICY "rsr_update" ON public.recipe_sub_recipes
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.recipes r
            WHERE r.id = recipe_sub_recipes.recipe_id
              AND r.restaurant_id = get_my_restaurant_id()
        )
    );

CREATE POLICY "rsr_delete" ON public.recipe_sub_recipes
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.recipes r
            WHERE r.id = recipe_sub_recipes.recipe_id
              AND r.restaurant_id = get_my_restaurant_id()
        )
    );

-- Índices para performance nas queries de composição
CREATE INDEX IF NOT EXISTS idx_rsr_recipe_id
    ON public.recipe_sub_recipes(recipe_id);
CREATE INDEX IF NOT EXISTS idx_rsr_sub_recipe_id
    ON public.recipe_sub_recipes(sub_recipe_id);

-- ============================================================
-- 5. COLUNAS brand_color E logo_url EM restaurantes
--    Fundação do sistema de tema por cliente.
-- ============================================================
ALTER TABLE public.restaurantes
ADD COLUMN IF NOT EXISTS brand_color text DEFAULT '#2563eb',
ADD COLUMN IF NOT EXISTS logo_url    text;

-- ============================================================
-- 6. RPC: get_my_membership (atualizada)
--    Agora retorna brand_color e logo_url do restaurante.
--    Usado no AuthContext para alimentar o sistema de tema.
-- ============================================================
DROP FUNCTION IF EXISTS public.get_my_membership();
CREATE OR REPLACE FUNCTION public.get_my_membership()
RETURNS TABLE(
    membro_id        uuid,
    restaurante_id   uuid,
    restaurante_nome text,
    perfil           text,
    brand_color      text,
    logo_url         text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
        SELECT
            m.id              AS membro_id,
            m.restaurante_id,
            r.nome            AS restaurante_nome,
            m.perfil,
            r.brand_color,
            r.logo_url
        FROM public.membros m
        JOIN public.restaurantes r ON r.id = m.restaurante_id
        WHERE m.usuario_id = auth.uid()
        ORDER BY m.criado_em
        LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_membership() TO authenticated;

-- ============================================================
-- 7. RPC: create_restaurant (atualizada)
--    Aceita p_brand_color opcional para definir a cor da marca
--    já no onboarding.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_restaurant(
    p_nome        text,
    p_cnpj        text    DEFAULT NULL,
    p_brand_color text    DEFAULT '#2563eb'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_restaurant_id uuid;
    v_user_id       uuid := auth.uid();
BEGIN
    INSERT INTO public.restaurantes (nome, cnpj, brand_color)
    VALUES (
        p_nome,
        NULLIF(TRIM(COALESCE(p_cnpj, '')), ''),
        COALESCE(NULLIF(TRIM(p_brand_color), ''), '#2563eb')
    )
    RETURNING id INTO v_restaurant_id;

    INSERT INTO public.membros (usuario_id, restaurante_id, perfil)
    VALUES (v_user_id, v_restaurant_id, 'dono')
    ON CONFLICT DO NOTHING;

    UPDATE public.profiles
    SET restaurant_id = v_restaurant_id
    WHERE id = v_user_id;

    RETURN v_restaurant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_restaurant(text, text, text) TO authenticated;
