-- =============================================================
-- Migration 026 — RPC salvar_composicao (DELETE+INSERT atômico)
--
-- PROBLEMA (auditoria #12):
--   Preparos e Recipes salvavam a composição fazendo DELETE de tudo e depois
--   INSERT, sem transação. Se o INSERT falhasse (rede/RLS/constraint), a
--   composição já tinha sido apagada do banco → perda de dados (o fetchData de
--   fallback só ressincronizava a UI com o dado já perdido).
--
-- FIX:
--   RPC única, SECURITY DEFINER, que valida o tenant e faz DELETE+INSERT dentro
--   do mesmo statement (corpo de função = atômico; erro faz rollback de tudo).
--   Preserva o modelo de storage de cada tela:
--     • p_ri  → recipe_ingredients (aceita ingredient_id OU sub_recipe_id)
--     • p_rsr → recipe_sub_recipes
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.salvar_composicao(
    p_recipe_id uuid,
    p_ri        jsonb DEFAULT '[]'::jsonb,
    p_rsr       jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_restaurante uuid;
    v_recipe_rest uuid;
BEGIN
    v_restaurante := public.get_my_restaurant_id();
    IF v_restaurante IS NULL THEN
        RAISE EXCEPTION 'Sem restaurante ativo';
    END IF;

    SELECT restaurant_id INTO v_recipe_rest FROM public.recipes WHERE id = p_recipe_id;
    IF v_recipe_rest IS NULL OR v_recipe_rest <> v_restaurante THEN
        RAISE EXCEPTION 'Receita não pertence ao restaurante ativo';
    END IF;

    -- Limpa composição atual
    DELETE FROM public.recipe_ingredients WHERE recipe_id = p_recipe_id;
    DELETE FROM public.recipe_sub_recipes WHERE recipe_id = p_recipe_id;

    -- Reinsere recipe_ingredients (insumos e/ou sub-preparos no modelo do Preparos)
    INSERT INTO public.recipe_ingredients (recipe_id, ingredient_id, sub_recipe_id, quantity_needed)
    SELECT p_recipe_id,
           NULLIF(e->>'ingredient_id', '')::uuid,
           NULLIF(e->>'sub_recipe_id', '')::uuid,
           (e->>'quantity_needed')::numeric
    FROM jsonb_array_elements(COALESCE(p_ri, '[]'::jsonb)) e;

    -- Reinsere recipe_sub_recipes (modelo do Recipes)
    INSERT INTO public.recipe_sub_recipes (recipe_id, sub_recipe_id, quantity_needed)
    SELECT p_recipe_id,
           (e->>'sub_recipe_id')::uuid,
           (e->>'quantity_needed')::numeric
    FROM jsonb_array_elements(COALESCE(p_rsr, '[]'::jsonb)) e;
END;
$$;

GRANT EXECUTE ON FUNCTION public.salvar_composicao(uuid, jsonb, jsonb) TO authenticated;

COMMIT;
