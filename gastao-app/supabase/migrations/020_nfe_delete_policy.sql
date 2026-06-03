-- =============================================================
-- 020 — notas_fiscais: policy de DELETE
-- Faltava a policy de DELETE, então o app não conseguia excluir
-- uma nota importada (o RLS bloqueava silenciosamente). Os itens
-- (nfe_itens) caem por cascata via FK nfe_itens_nota_fiscal_id_fkey
-- (ON DELETE CASCADE), então basta liberar o delete da nota.
-- Mesmo escopo das demais policies: só o próprio restaurante.
-- =============================================================

DROP POLICY IF EXISTS "notas_fiscais_delete" ON public.notas_fiscais;
CREATE POLICY "notas_fiscais_delete" ON public.notas_fiscais
    FOR DELETE USING (restaurante_id = get_my_restaurant_id());
