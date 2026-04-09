-- =============================================================
-- Gastão — Sessão 3: NF-e Import System
-- Execute no Supabase SQL Editor (Dashboard → SQL Editor)
-- Pré-requisitos: restaurantes, ingredients e
--   get_my_restaurant_id() já existem.
-- =============================================================

-- ========================
-- 1. TABELA notas_fiscais
-- ========================
CREATE TABLE IF NOT EXISTS public.notas_fiscais (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurante_id  uuid        NOT NULL REFERENCES public.restaurantes(id) ON DELETE CASCADE,
    numero_nota     text,
    fornecedor_nome text,
    fornecedor_cnpj text,
    data_emissao    timestamptz,
    valor_total     numeric,
    xml_url         text,        -- path no Supabase Storage onde o XML original fica guardado
    status          text        NOT NULL DEFAULT 'pendente'
                                CHECK (status IN ('pendente', 'confirmada', 'cancelada')),
    criado_em       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notas_fiscais ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notas_fiscais_select" ON public.notas_fiscais;
DROP POLICY IF EXISTS "notas_fiscais_insert" ON public.notas_fiscais;
DROP POLICY IF EXISTS "notas_fiscais_update" ON public.notas_fiscais;

CREATE POLICY "notas_fiscais_select" ON public.notas_fiscais
    FOR SELECT USING (restaurante_id = get_my_restaurant_id());

CREATE POLICY "notas_fiscais_insert" ON public.notas_fiscais
    FOR INSERT WITH CHECK (restaurante_id = get_my_restaurant_id());

CREATE POLICY "notas_fiscais_update" ON public.notas_fiscais
    FOR UPDATE USING (restaurante_id = get_my_restaurant_id());

-- ========================
-- 2. TABELA nfe_itens
-- ========================
CREATE TABLE IF NOT EXISTS public.nfe_itens (
    id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    nota_fiscal_id       uuid        NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE CASCADE,
    restaurante_id       uuid        NOT NULL REFERENCES public.restaurantes(id) ON DELETE CASCADE,
    codigo_produto       text,                                        -- cProd do XML
    descricao_xml        text        NOT NULL,                        -- xProd — nome original na nota
    quantidade           numeric     NOT NULL,
    unidade              text        NOT NULL,                        -- uCom
    valor_unitario       numeric     NOT NULL,
    valor_total          numeric     NOT NULL,
    insumo_sugerido_id   uuid        REFERENCES public.ingredients(id), -- match sugerido pela IA
    insumo_confirmado_id uuid        REFERENCES public.ingredients(id), -- match confirmado pelo usuário
    confianca_match      numeric     CHECK (confianca_match >= 0 AND confianca_match <= 1),
    status               text        NOT NULL DEFAULT 'pendente'
                                     CHECK (status IN ('pendente', 'vinculado', 'ignorado', 'novo_insumo')),
    criado_em            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nfe_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nfe_itens_select" ON public.nfe_itens;
DROP POLICY IF EXISTS "nfe_itens_insert" ON public.nfe_itens;
DROP POLICY IF EXISTS "nfe_itens_update" ON public.nfe_itens;

CREATE POLICY "nfe_itens_select" ON public.nfe_itens
    FOR SELECT USING (restaurante_id = get_my_restaurant_id());

CREATE POLICY "nfe_itens_insert" ON public.nfe_itens
    FOR INSERT WITH CHECK (restaurante_id = get_my_restaurant_id());

CREATE POLICY "nfe_itens_update" ON public.nfe_itens
    FOR UPDATE USING (restaurante_id = get_my_restaurant_id());

-- ========================
-- 3. ÍNDICES
-- ========================
CREATE INDEX IF NOT EXISTS idx_nfe_itens_nota
    ON public.nfe_itens(nota_fiscal_id);

CREATE INDEX IF NOT EXISTS idx_notas_fiscais_restaurante
    ON public.notas_fiscais(restaurante_id, criado_em DESC);

-- ========================
-- 4. RPC confirmar_nfe
-- ========================
CREATE OR REPLACE FUNCTION public.confirmar_nfe(p_nota_fiscal_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_restaurante_id uuid;
    v_item           RECORD;
    v_insumo         RECORD;
    v_novo_custo     numeric;
    v_processados    integer := 0;
BEGIN
    -- Verifica que a nota pertence ao restaurante do usuário logado
    SELECT restaurante_id INTO v_restaurante_id
    FROM public.notas_fiscais
    WHERE id = p_nota_fiscal_id
      AND restaurante_id = get_my_restaurant_id();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nota fiscal não encontrada ou sem permissão';
    END IF;

    -- Itera sobre os itens vinculados com insumo confirmado
    FOR v_item IN
        SELECT id, insumo_confirmado_id, quantidade, valor_unitario
        FROM public.nfe_itens
        WHERE nota_fiscal_id = p_nota_fiscal_id
          AND status = 'vinculado'
          AND insumo_confirmado_id IS NOT NULL
    LOOP
        -- Busca dados atuais do insumo
        SELECT id, stock_quantity, avg_cost_per_unit
        INTO v_insumo
        FROM public.ingredients
        WHERE id = v_item.insumo_confirmado_id;

        IF NOT FOUND THEN CONTINUE; END IF;

        -- Custo médio ponderado
        IF COALESCE(v_insumo.stock_quantity, 0) <= 0 THEN
            v_novo_custo := v_item.valor_unitario;
        ELSE
            v_novo_custo := (
                (v_insumo.stock_quantity * COALESCE(v_insumo.avg_cost_per_unit, 0))
                + (v_item.quantidade * v_item.valor_unitario)
            ) / (v_insumo.stock_quantity + v_item.quantidade);
        END IF;

        -- Garante que o custo nunca seja negativo ou zero
        IF v_novo_custo <= 0 THEN
            v_novo_custo := v_item.valor_unitario;
        END IF;

        -- Atualiza custo e estoque do insumo
        UPDATE public.ingredients
        SET avg_cost_per_unit = v_novo_custo,
            stock_quantity    = COALESCE(stock_quantity, 0) + v_item.quantidade
        WHERE id = v_item.insumo_confirmado_id;

        v_processados := v_processados + 1;
    END LOOP;

    -- Marca nota como confirmada
    UPDATE public.notas_fiscais
    SET status = 'confirmada'
    WHERE id = p_nota_fiscal_id;

    RETURN v_processados;
END;
$$;
