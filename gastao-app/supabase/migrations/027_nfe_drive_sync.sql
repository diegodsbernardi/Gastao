-- 027: Ponte Google Drive → NF-e
-- 1) Dedup por chave de acesso (44 dígitos, única por nota na SEFAZ).
-- 2) Origem da nota (upload manual vs. robô do Drive).
-- 3) Tabela de configuração do sync: qual pasta do Drive alimenta qual restaurante.

ALTER TABLE public.notas_fiscais
    ADD COLUMN IF NOT EXISTS chave_acesso text,
    ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'upload'
        CHECK (origem IN ('upload', 'drive'));

-- Única por restaurante (a mesma chave nunca deve entrar 2x no mesmo tenant).
-- Parcial: notas antigas/sem chave não conflitam entre si.
CREATE UNIQUE INDEX IF NOT EXISTS notas_fiscais_chave_acesso_unica
    ON public.notas_fiscais (restaurante_id, chave_acesso)
    WHERE chave_acesso IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.nfe_drive_sync (
    restaurante_id  uuid PRIMARY KEY REFERENCES public.restaurantes(id) ON DELETE CASCADE,
    drive_folder_id text NOT NULL,          -- pasta "NotasEntrada" do restaurante no Drive
    ativo           boolean NOT NULL DEFAULT true,
    last_sync_at    timestamptz,
    last_result     text,                   -- resumo da última rodada (ex.: "3 novas, 12 já importadas")
    criado_em       timestamptz NOT NULL DEFAULT now()
);

-- RLS ligado sem policies: só service_role/postgres (o robô) tocam nessa tabela.
-- Quando houver UI de monitoramento, criar policy de SELECT para membros/BPO.
ALTER TABLE public.nfe_drive_sync ENABLE ROW LEVEL SECURITY;
