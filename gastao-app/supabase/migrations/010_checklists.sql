-- =============================================================
-- Gastão — Sessão 10: Checklists Operacionais
-- Execute no Supabase SQL Editor (Dashboard → SQL Editor)
-- Pré-requisitos: restaurantes, membros, profiles, get_my_restaurant_id()
--   e as migrations 001..009 já executadas.
-- =============================================================
--
-- Modelo:
--   checklist_templates       → definição (ex: "Abertura", "Fechamento")
--   checklist_template_items  → itens do template, ordenados por position
--   checklist_runs            → uma execução do checklist (1 por dia, tipicamente)
--   checklist_run_items       → estado de cada item dentro da run
--
-- Uso esperado:
--   1. Dono/Gerente cria o template uma única vez ("Abertura do bar", 12 itens)
--   2. Todo dia, alguém da equipe abre o checklist → cria uma run
--   3. Marca cada item como feito conforme avança
--   4. Dashboard mostra pendências e histórico
-- =============================================================

-- ============================================================
-- 1. TEMPLATES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.checklist_templates (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  uuid        NOT NULL REFERENCES public.restaurantes(id) ON DELETE CASCADE,
    nome           text        NOT NULL,
    descricao      text,
    /* Frequência orientada — não cria runs automaticamente; apenas informa a UI */
    frequencia     text        NOT NULL DEFAULT 'diario'
                                CHECK (frequencia IN ('diario', 'semanal', 'mensal', 'avulso')),
    ativo          boolean     NOT NULL DEFAULT true,
    criado_em      timestamptz NOT NULL DEFAULT now(),
    criado_por     uuid        REFERENCES auth.users(id)
);

ALTER TABLE public.checklist_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ct_select" ON public.checklist_templates;
DROP POLICY IF EXISTS "ct_insert" ON public.checklist_templates;
DROP POLICY IF EXISTS "ct_update" ON public.checklist_templates;
DROP POLICY IF EXISTS "ct_delete" ON public.checklist_templates;

CREATE POLICY "ct_select" ON public.checklist_templates
    FOR SELECT USING (restaurant_id = get_my_restaurant_id());

CREATE POLICY "ct_insert" ON public.checklist_templates
    FOR INSERT WITH CHECK (restaurant_id = get_my_restaurant_id());

CREATE POLICY "ct_update" ON public.checklist_templates
    FOR UPDATE USING (restaurant_id = get_my_restaurant_id());

CREATE POLICY "ct_delete" ON public.checklist_templates
    FOR DELETE USING (restaurant_id = get_my_restaurant_id());

CREATE INDEX IF NOT EXISTS idx_ct_restaurant_ativo
    ON public.checklist_templates(restaurant_id, ativo);

-- ============================================================
-- 2. ITENS DO TEMPLATE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.checklist_template_items (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id    uuid        NOT NULL REFERENCES public.checklist_templates(id) ON DELETE CASCADE,
    position       integer     NOT NULL DEFAULT 0,
    titulo         text        NOT NULL,
    descricao      text,
    /* Flags simples — podemos adicionar mais depois (foto obrigatória, assinatura, etc.) */
    requer_nota    boolean     NOT NULL DEFAULT false,
    criado_em      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.checklist_template_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cti_select" ON public.checklist_template_items;
DROP POLICY IF EXISTS "cti_insert" ON public.checklist_template_items;
DROP POLICY IF EXISTS "cti_update" ON public.checklist_template_items;
DROP POLICY IF EXISTS "cti_delete" ON public.checklist_template_items;

-- RLS via join no template pai
CREATE POLICY "cti_select" ON public.checklist_template_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.checklist_templates t
            WHERE t.id = checklist_template_items.template_id
              AND t.restaurant_id = get_my_restaurant_id()
        )
    );

CREATE POLICY "cti_insert" ON public.checklist_template_items
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.checklist_templates t
            WHERE t.id = checklist_template_items.template_id
              AND t.restaurant_id = get_my_restaurant_id()
        )
    );

CREATE POLICY "cti_update" ON public.checklist_template_items
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.checklist_templates t
            WHERE t.id = checklist_template_items.template_id
              AND t.restaurant_id = get_my_restaurant_id()
        )
    );

CREATE POLICY "cti_delete" ON public.checklist_template_items
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.checklist_templates t
            WHERE t.id = checklist_template_items.template_id
              AND t.restaurant_id = get_my_restaurant_id()
        )
    );

CREATE INDEX IF NOT EXISTS idx_cti_template_position
    ON public.checklist_template_items(template_id, position);

-- ============================================================
-- 3. RUNS — uma execução do checklist
-- ============================================================
CREATE TABLE IF NOT EXISTS public.checklist_runs (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  uuid        NOT NULL REFERENCES public.restaurantes(id) ON DELETE CASCADE,
    template_id    uuid        NOT NULL REFERENCES public.checklist_templates(id) ON DELETE RESTRICT,
    /* Data de referência do checklist (não necessariamente a data de conclusão) */
    data_referencia date       NOT NULL DEFAULT CURRENT_DATE,
    status         text        NOT NULL DEFAULT 'em_andamento'
                                CHECK (status IN ('em_andamento', 'concluido', 'cancelado')),
    iniciado_em    timestamptz NOT NULL DEFAULT now(),
    iniciado_por   uuid        REFERENCES auth.users(id),
    concluido_em   timestamptz,
    concluido_por  uuid        REFERENCES auth.users(id),
    observacoes    text
);

ALTER TABLE public.checklist_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cr_select" ON public.checklist_runs;
DROP POLICY IF EXISTS "cr_insert" ON public.checklist_runs;
DROP POLICY IF EXISTS "cr_update" ON public.checklist_runs;
DROP POLICY IF EXISTS "cr_delete" ON public.checklist_runs;

CREATE POLICY "cr_select" ON public.checklist_runs
    FOR SELECT USING (restaurant_id = get_my_restaurant_id());

CREATE POLICY "cr_insert" ON public.checklist_runs
    FOR INSERT WITH CHECK (restaurant_id = get_my_restaurant_id());

CREATE POLICY "cr_update" ON public.checklist_runs
    FOR UPDATE USING (restaurant_id = get_my_restaurant_id());

CREATE POLICY "cr_delete" ON public.checklist_runs
    FOR DELETE USING (restaurant_id = get_my_restaurant_id());

CREATE INDEX IF NOT EXISTS idx_cr_restaurant_data
    ON public.checklist_runs(restaurant_id, data_referencia DESC);

CREATE INDEX IF NOT EXISTS idx_cr_template
    ON public.checklist_runs(template_id);

-- Constraint: no máximo 1 run "em_andamento" por template por dia
-- (evita que duas pessoas abram o mesmo checklist e bagunce)
CREATE UNIQUE INDEX IF NOT EXISTS uq_cr_one_open_per_day
    ON public.checklist_runs(template_id, data_referencia)
    WHERE status = 'em_andamento';

-- ============================================================
-- 4. ESTADO DE CADA ITEM DENTRO DE UMA RUN
-- ============================================================
CREATE TABLE IF NOT EXISTS public.checklist_run_items (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id           uuid        NOT NULL REFERENCES public.checklist_runs(id) ON DELETE CASCADE,
    template_item_id uuid        NOT NULL REFERENCES public.checklist_template_items(id) ON DELETE RESTRICT,
    feito            boolean     NOT NULL DEFAULT false,
    feito_em         timestamptz,
    feito_por        uuid        REFERENCES auth.users(id),
    nota             text,
    UNIQUE (run_id, template_item_id)
);

ALTER TABLE public.checklist_run_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cri_select" ON public.checklist_run_items;
DROP POLICY IF EXISTS "cri_insert" ON public.checklist_run_items;
DROP POLICY IF EXISTS "cri_update" ON public.checklist_run_items;
DROP POLICY IF EXISTS "cri_delete" ON public.checklist_run_items;

CREATE POLICY "cri_select" ON public.checklist_run_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.checklist_runs r
            WHERE r.id = checklist_run_items.run_id
              AND r.restaurant_id = get_my_restaurant_id()
        )
    );

CREATE POLICY "cri_insert" ON public.checklist_run_items
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.checklist_runs r
            WHERE r.id = checklist_run_items.run_id
              AND r.restaurant_id = get_my_restaurant_id()
        )
    );

CREATE POLICY "cri_update" ON public.checklist_run_items
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.checklist_runs r
            WHERE r.id = checklist_run_items.run_id
              AND r.restaurant_id = get_my_restaurant_id()
        )
    );

CREATE POLICY "cri_delete" ON public.checklist_run_items
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.checklist_runs r
            WHERE r.id = checklist_run_items.run_id
              AND r.restaurant_id = get_my_restaurant_id()
        )
    );

CREATE INDEX IF NOT EXISTS idx_cri_run
    ON public.checklist_run_items(run_id);

-- ============================================================
-- 5. RPC: start_checklist_run
-- Cria uma run "em_andamento" com todos os items do template pré-populados
-- como não-feitos. Se já existe uma run aberta hoje, retorna a existente.
-- ============================================================
CREATE OR REPLACE FUNCTION public.start_checklist_run(p_template_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_restaurant_id uuid := get_my_restaurant_id();
    v_user_id       uuid := auth.uid();
    v_run_id        uuid;
BEGIN
    IF v_restaurant_id IS NULL THEN
        RAISE EXCEPTION 'Usuário sem restaurante';
    END IF;

    -- Reaproveita run aberta do dia, se existir
    SELECT id INTO v_run_id
    FROM public.checklist_runs
    WHERE template_id = p_template_id
      AND data_referencia = CURRENT_DATE
      AND status = 'em_andamento'
    LIMIT 1;

    IF v_run_id IS NOT NULL THEN
        RETURN v_run_id;
    END IF;

    -- Cria nova run
    INSERT INTO public.checklist_runs (restaurant_id, template_id, iniciado_por)
    VALUES (v_restaurant_id, p_template_id, v_user_id)
    RETURNING id INTO v_run_id;

    -- Pré-popula run_items com todos os items do template
    INSERT INTO public.checklist_run_items (run_id, template_item_id)
    SELECT v_run_id, i.id
    FROM public.checklist_template_items i
    WHERE i.template_id = p_template_id
    ORDER BY i.position;

    RETURN v_run_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_checklist_run(uuid) TO authenticated;

-- ============================================================
-- 6. RPC: complete_checklist_run
-- Marca a run como concluída (precisa estar em_andamento)
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_checklist_run(p_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_restaurant_id uuid := get_my_restaurant_id();
    v_user_id       uuid := auth.uid();
BEGIN
    UPDATE public.checklist_runs
    SET status        = 'concluido',
        concluido_em  = now(),
        concluido_por = v_user_id
    WHERE id = p_run_id
      AND restaurant_id = v_restaurant_id
      AND status = 'em_andamento';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Run não encontrada ou já concluída';
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_checklist_run(uuid) TO authenticated;
