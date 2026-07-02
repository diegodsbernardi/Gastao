-- =============================================================
-- Migration 023 — Checklists no fuso de São Paulo (não UTC)
--
-- PROBLEMA (auditoria):
--   checklist_runs.data_referencia default = CURRENT_DATE (UTC) e o reuse em
--   start_checklist_run compara CURRENT_DATE (UTC), mas o cliente
--   (Checklists.tsx) monta "hoje" no fuso local do navegador (BRT). Entre 21h
--   e 00h BRT — horário de fechamento de hamburgueria — a run recebe a data de
--   "amanhã" em UTC; a lista do dia (BRT) não a encontra: progresso some e
--   "abrir checklist de hoje" reabre outra run.
--
-- FIX:
--   Servidor passa a usar America/Sao_Paulo, coerente com o cliente.
-- =============================================================

BEGIN;

ALTER TABLE public.checklist_runs
    ALTER COLUMN data_referencia
    SET DEFAULT (timezone('America/Sao_Paulo', now()))::date;

CREATE OR REPLACE FUNCTION public.start_checklist_run(p_template_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_restaurant_id uuid := get_my_restaurant_id();
    v_user_id       uuid := auth.uid();
    v_hoje          date := (timezone('America/Sao_Paulo', now()))::date;
    v_run_id        uuid;
BEGIN
    IF v_restaurant_id IS NULL THEN
        RAISE EXCEPTION 'Usuário sem restaurante';
    END IF;

    -- Reaproveita run aberta do dia (fuso BRT), se existir
    SELECT id INTO v_run_id
    FROM public.checklist_runs
    WHERE template_id = p_template_id
      AND data_referencia = v_hoje
      AND status = 'em_andamento'
    LIMIT 1;

    IF v_run_id IS NOT NULL THEN
        RETURN v_run_id;
    END IF;

    -- Cria nova run com data_referencia BRT explícita
    INSERT INTO public.checklist_runs (restaurant_id, template_id, iniciado_por, data_referencia)
    VALUES (v_restaurant_id, p_template_id, v_user_id, v_hoje)
    RETURNING id INTO v_run_id;

    INSERT INTO public.checklist_run_items (run_id, template_item_id)
    SELECT v_run_id, i.id
    FROM public.checklist_template_items i
    WHERE i.template_id = p_template_id
    ORDER BY i.position;

    RETURN v_run_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_checklist_run(uuid) TO authenticated;

COMMIT;
