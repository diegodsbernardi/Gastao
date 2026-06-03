-- =============================================================
-- 019 — nfe_itens: unidade tributável
-- Toda NF-e traz dois pares de unidade por item: o comercial
-- (uCom/qCom/vUnCom, ex: "2 CX") e o tributável (uTrib/qTrib/vUnTrib,
-- ex: "20,03 KG"). O tributável é a unidade física real e é o que
-- permite converter a embalagem de compra na unidade da ficha técnica
-- (ex: 2 CX = 20,03 kg → R$ 25,68/kg). Até aqui só o comercial era
-- guardado; estas colunas passam a persistir o tributável.
-- =============================================================

ALTER TABLE public.nfe_itens
    ADD COLUMN IF NOT EXISTS quantidade_tributavel       numeric,
    ADD COLUMN IF NOT EXISTS unidade_tributavel          text,
    ADD COLUMN IF NOT EXISTS valor_unitario_tributavel   numeric;
