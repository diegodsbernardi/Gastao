-- =====================================================================
-- RESET TOTAL — apaga TODAS as informações de receitas/insumos/vendas/NFe/
-- checklists/feedbacks de TODOS os restaurantes, preservando:
--   • restaurantes (a linha do restaurante em si)
--   • profiles, membros, convites (acessos / usuários)
--
-- Modo de uso:
--   1. Abre o SQL Editor do Supabase
--   2. Cola este script inteiro
--   3. Roda
--   4. Confere os counts "ANTES" e "DEPOIS"
--   5. No fim: se tudo ok, o script já faz COMMIT. Se quiser abortar,
--      edita a última linha pra "ROLLBACK" e roda de novo.
-- =====================================================================

BEGIN;

-- ── CONTAGEM ANTES ─────────────────────────────────────────────────
SELECT 'ANTES' as fase, 'ingredients'          as tabela, count(*) from public.ingredients
UNION ALL SELECT 'ANTES', 'ingredient_categories', count(*) from public.ingredient_categories
UNION ALL SELECT 'ANTES', 'recipes',               count(*) from public.recipes
UNION ALL SELECT 'ANTES', 'recipe_ingredients',    count(*) from public.recipe_ingredients
UNION ALL SELECT 'ANTES', 'recipe_sub_recipes',    count(*) from public.recipe_sub_recipes
UNION ALL SELECT 'ANTES', 'sales',                 count(*) from public.sales
UNION ALL SELECT 'ANTES', 'notas_fiscais',         count(*) from public.notas_fiscais
UNION ALL SELECT 'ANTES', 'nfe_itens',             count(*) from public.nfe_itens
UNION ALL SELECT 'ANTES', 'checklist_templates',       count(*) from public.checklist_templates
UNION ALL SELECT 'ANTES', 'checklist_template_items',  count(*) from public.checklist_template_items
UNION ALL SELECT 'ANTES', 'checklist_runs',            count(*) from public.checklist_runs
UNION ALL SELECT 'ANTES', 'checklist_run_items',       count(*) from public.checklist_run_items
UNION ALL SELECT 'ANTES', 'feedbacks',           count(*) from public.feedbacks
UNION ALL SELECT 'ANTES', 'feedback_recipients', count(*) from public.feedback_recipients
UNION ALL SELECT 'ANTES', 'feedback_reads',      count(*) from public.feedback_reads
UNION ALL SELECT 'ANTES', '--preservado:',       0
UNION ALL SELECT 'ANTES', 'restaurantes',        count(*) from public.restaurantes
UNION ALL SELECT 'ANTES', 'profiles',            count(*) from public.profiles
UNION ALL SELECT 'ANTES', 'membros',             count(*) from public.membros
UNION ALL SELECT 'ANTES', 'convites',            count(*) from public.convites;

-- ── DELETES (ordem respeita FKs) ───────────────────────────────────

-- 1) Filhos das receitas (cascade auto via recipes, mas explicito pra clareza)
DELETE FROM public.recipe_sub_recipes;
DELETE FROM public.recipe_ingredients;

-- 2) Vendas (FK para recipes — cascade também, mas explicito)
DELETE FROM public.sales;

-- 3) Receitas (fichas + preparos)
DELETE FROM public.recipes;

-- 4) NFe — nfe_itens tem FK SEM CASCADE pra ingredients, precisa vir antes
DELETE FROM public.nfe_itens;
DELETE FROM public.notas_fiscais;

-- 5) Insumos e categorias
DELETE FROM public.ingredients;
DELETE FROM public.ingredient_categories;

-- 6) Checklists (filhos primeiro)
DELETE FROM public.checklist_run_items;
DELETE FROM public.checklist_runs;
DELETE FROM public.checklist_template_items;
DELETE FROM public.checklist_templates;

-- 7) Feedbacks (filhos primeiro)
DELETE FROM public.feedback_reads;
DELETE FROM public.feedback_recipients;
DELETE FROM public.feedbacks;

-- ── CONTAGEM DEPOIS ────────────────────────────────────────────────
SELECT 'DEPOIS' as fase, 'ingredients'          as tabela, count(*) from public.ingredients
UNION ALL SELECT 'DEPOIS', 'ingredient_categories', count(*) from public.ingredient_categories
UNION ALL SELECT 'DEPOIS', 'recipes',               count(*) from public.recipes
UNION ALL SELECT 'DEPOIS', 'recipe_ingredients',    count(*) from public.recipe_ingredients
UNION ALL SELECT 'DEPOIS', 'recipe_sub_recipes',    count(*) from public.recipe_sub_recipes
UNION ALL SELECT 'DEPOIS', 'sales',                 count(*) from public.sales
UNION ALL SELECT 'DEPOIS', 'notas_fiscais',         count(*) from public.notas_fiscais
UNION ALL SELECT 'DEPOIS', 'nfe_itens',             count(*) from public.nfe_itens
UNION ALL SELECT 'DEPOIS', 'checklist_templates',       count(*) from public.checklist_templates
UNION ALL SELECT 'DEPOIS', 'checklist_template_items',  count(*) from public.checklist_template_items
UNION ALL SELECT 'DEPOIS', 'checklist_runs',            count(*) from public.checklist_runs
UNION ALL SELECT 'DEPOIS', 'checklist_run_items',       count(*) from public.checklist_run_items
UNION ALL SELECT 'DEPOIS', 'feedbacks',           count(*) from public.feedbacks
UNION ALL SELECT 'DEPOIS', 'feedback_recipients', count(*) from public.feedback_recipients
UNION ALL SELECT 'DEPOIS', 'feedback_reads',      count(*) from public.feedback_reads
UNION ALL SELECT 'DEPOIS', '--preservado:',       0
UNION ALL SELECT 'DEPOIS', 'restaurantes',        count(*) from public.restaurantes
UNION ALL SELECT 'DEPOIS', 'profiles',            count(*) from public.profiles
UNION ALL SELECT 'DEPOIS', 'membros',             count(*) from public.membros
UNION ALL SELECT 'DEPOIS', 'convites',            count(*) from public.convites;

-- Se algo parecer errado, troque a linha abaixo por ROLLBACK; e rode de novo.
COMMIT;
