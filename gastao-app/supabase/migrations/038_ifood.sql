-- =============================================================
-- Migration 038 — Canal iFood: taxas, campanhas e preço sugerido
--
-- PROBLEMA: o restaurante cadastra a ficha com o preço do SALÃO e usa o mesmo
-- número (ou um chute) no iFood. Só que no delivery ele não recebe o preço
-- cheio: sai comissão do iFood, sai o cupom da campanha que ele aceitou e, se
-- oferece frete grátis, sai também o frete. O CMV que o app mostra é o do
-- salão, e a margem real do delivery fica invisível.
--
-- O QUE ESTA MIGRATION GUARDA: só o que é entrada humana — a configuração do
-- canal por restaurante e o preço que ele pratica hoje no iFood. O preço
-- sugerido NÃO é coluna: é cálculo, e derivar em vez de gravar evita número
-- velho na tela quando a taxa ou o preço de salão mudarem.
--
-- A CONTA (implementada no app, documentada aqui):
--   No salão:  lucro = Pv - Custo
--   No iFood:  lucro = P·(1 - taxa - cupom) - frete - Custo
--   Igualando os dois e cortando o Custo dos dois lados:
--       P = (Pv + frete) / (1 - taxa - cupom)
--   Ou seja: o preço que empata a margem do delivery com a do salão não
--   depende do custo do prato, e sim do preço de salão, do frete bancado e
--   das taxas. Vale para qualquer ficha.
-- =============================================================

-- ── Configuração do canal, uma linha por restaurante ────────────────────────
CREATE TABLE IF NOT EXISTS public.ifood_config (
    restaurante_id      uuid        PRIMARY KEY REFERENCES public.restaurantes(id) ON DELETE CASCADE,
    -- 'propria'  = restaurante entrega (comissão menor, ~12,5%)
    -- 'parceira' = entrega pelo iFood  (comissão maior, ~24%)
    modelo_entrega      text        NOT NULL DEFAULT 'propria'
                                    CHECK (modelo_entrega IN ('propria', 'parceira')),
    taxa_pct            numeric     NOT NULL DEFAULT 12.5
                                    CHECK (taxa_pct >= 0 AND taxa_pct < 100),
    participa_campanhas boolean     NOT NULL DEFAULT false,
    -- desconto médio que o restaurante banca nas campanhas/cupons
    cupom_pct           numeric     NOT NULL DEFAULT 0
                                    CHECK (cupom_pct >= 0 AND cupom_pct < 100),
    frete_gratis        boolean     NOT NULL DEFAULT false,
    -- quanto ele banca de frete por pedido quando oferece frete grátis
    frete_gratis_valor  numeric     NOT NULL DEFAULT 0
                                    CHECK (frete_gratis_valor >= 0),
    -- trava de sanidade: taxa + cupom precisam sobrar alguma receita
    CONSTRAINT ifood_config_taxas_somam_menos_de_100
        CHECK (taxa_pct + cupom_pct < 95),
    atualizado_em       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ifood_config IS
    'Configuração do canal iFood por restaurante. O preço sugerido é derivado no app, não gravado.';

ALTER TABLE public.ifood_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ifood_config_select" ON public.ifood_config;
CREATE POLICY "ifood_config_select" ON public.ifood_config
    FOR SELECT USING (restaurante_id = get_my_restaurant_id());

DROP POLICY IF EXISTS "ifood_config_insert" ON public.ifood_config;
CREATE POLICY "ifood_config_insert" ON public.ifood_config
    FOR INSERT WITH CHECK (restaurante_id = get_my_restaurant_id());

DROP POLICY IF EXISTS "ifood_config_update" ON public.ifood_config;
CREATE POLICY "ifood_config_update" ON public.ifood_config
    FOR UPDATE USING (restaurante_id = get_my_restaurant_id())
              WITH CHECK (restaurante_id = get_my_restaurant_id());

-- ── Preço praticado hoje no iFood, por ficha ────────────────────────────────
-- NULL = não vendido no delivery. Fica separado de sale_price porque os dois
-- canais têm preços diferentes de propósito, e o do salão é a referência de
-- margem.
ALTER TABLE public.recipes
    ADD COLUMN IF NOT EXISTS sale_price_ifood numeric
    CHECK (sale_price_ifood IS NULL OR sale_price_ifood >= 0);

COMMENT ON COLUMN public.recipes.sale_price_ifood IS
    'Preço praticado no iFood. NULL = produto não vendido no delivery.';
