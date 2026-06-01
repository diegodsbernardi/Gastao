-- =============================================================
-- Migration 018 — RPC duplicate_recipe (F1 do feedback CRIMINAL)
--
-- Duplica uma ficha/preparo completo: cria nova `recipes` row com
-- nome customizado e clona toda a composição (recipe_ingredients +
-- recipe_sub_recipes). Tudo em transação implícita — falha em
-- qualquer passo gera rollback.
--
-- Use case: chef do CRIMINAL quer criar 8 hambúrgueres similares
-- partindo de um base. Cria 1 ficha completa, duplica 7 vezes,
-- modifica detalhes.
-- =============================================================

CREATE OR REPLACE FUNCTION public.duplicate_recipe(
    p_recipe_id uuid,
    p_new_name  text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_recipe  RECORD;
    v_new_id      uuid;
    v_new_name    text;
    v_restaurant  uuid;
BEGIN
    -- Pega o restaurante atual via RPC existente (respeita ativo/switch)
    v_restaurant := public.get_my_restaurant_id();
    IF v_restaurant IS NULL THEN
        RAISE EXCEPTION 'Usuário sem restaurante ativo' USING ERRCODE = '42501';
    END IF;

    -- Valida que a receita existe E pertence ao restaurante atual.
    -- (SECURITY DEFINER bypassa RLS, então faço check manual.)
    SELECT * INTO v_old_recipe
    FROM public.recipes
    WHERE id = p_recipe_id AND restaurant_id = v_restaurant;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Receita não encontrada ou sem permissão' USING ERRCODE = '42501';
    END IF;

    -- Nome novo: usa o passado ou gera "X (cópia)"
    v_new_name := TRIM(COALESCE(p_new_name, v_old_recipe.product_name || ' (cópia)'));

    IF v_new_name = '' THEN
        RAISE EXCEPTION 'Nome da cópia não pode ser vazio';
    END IF;

    -- Cria a nova receita (mesma config)
    INSERT INTO public.recipes (
        restaurant_id, product_name, tipo, category,
        sale_price, yield_quantity, unit_type
    )
    VALUES (
        v_old_recipe.restaurant_id,
        v_new_name,
        v_old_recipe.tipo,
        v_old_recipe.category,
        v_old_recipe.sale_price,
        v_old_recipe.yield_quantity,
        v_old_recipe.unit_type
    )
    RETURNING id INTO v_new_id;

    -- Clona recipe_ingredients (cobre tanto insumo quanto sub_recipe via legado)
    INSERT INTO public.recipe_ingredients (
        recipe_id, ingredient_id, sub_recipe_id, quantity_needed, unit
    )
    SELECT v_new_id, ingredient_id, sub_recipe_id, quantity_needed, unit
    FROM public.recipe_ingredients
    WHERE recipe_id = p_recipe_id;

    -- Clona recipe_sub_recipes (tabela nova do schema 3-camadas)
    INSERT INTO public.recipe_sub_recipes (
        recipe_id, sub_recipe_id, quantity_needed
    )
    SELECT v_new_id, sub_recipe_id, quantity_needed
    FROM public.recipe_sub_recipes
    WHERE recipe_id = p_recipe_id;

    RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.duplicate_recipe(uuid, text) TO authenticated;
