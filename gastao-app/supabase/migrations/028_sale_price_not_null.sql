-- 028: sale_price nunca mais NULL
-- O import de fichas do Yalinha (jun/2026) criou 49 fichas com sale_price NULL,
-- que derrubava a tela de Fichas Técnicas (fmtMoney(null) → TypeError → tela branca).
-- Zera os nulos e trava a coluna: quem não tem preço definido fica com 0
-- (a UI já trata 0 como "sem CMV calculável").

UPDATE public.recipes SET sale_price = 0 WHERE sale_price IS NULL;

ALTER TABLE public.recipes
    ALTER COLUMN sale_price SET DEFAULT 0,
    ALTER COLUMN sale_price SET NOT NULL;
