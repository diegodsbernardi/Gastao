-- 029: Sync de NF-e sob demanda (botão "Buscar notas agora")
-- O botão na UI chama solicitar_sync_nfe(); o robô do VPS checa a cada 5 min
-- e atende os pedidos pendentes. O clear do pedido é feito pelo robô.

ALTER TABLE public.nfe_drive_sync
    ADD COLUMN IF NOT EXISTS sync_requested_at timestamptz;

-- Usuário do restaurante pode VER o status do sync (last_sync_at, last_result)
DROP POLICY IF EXISTS "nfe_drive_sync_select" ON public.nfe_drive_sync;
CREATE POLICY "nfe_drive_sync_select" ON public.nfe_drive_sync
    FOR SELECT USING (restaurante_id = get_my_restaurant_id());

-- Pedido de sync via RPC (não abrimos UPDATE direto na tabela: o usuário só
-- pode mexer no campo de pedido, e com no máximo 1 pedido por minuto).
CREATE OR REPLACE FUNCTION public.solicitar_sync_nfe()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_restaurante uuid;
    v_atual timestamptz;
BEGIN
    v_restaurante := get_my_restaurant_id();
    IF v_restaurante IS NULL THEN
        RAISE EXCEPTION 'Sem restaurante ativo';
    END IF;

    SELECT sync_requested_at INTO v_atual
    FROM nfe_drive_sync WHERE restaurante_id = v_restaurante AND ativo;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Este restaurante não tem sincronização com o Drive configurada';
    END IF;

    -- Anti-spam: 1 pedido por minuto
    IF v_atual IS NOT NULL AND v_atual > now() - interval '1 minute' THEN
        RETURN v_atual;
    END IF;

    UPDATE nfe_drive_sync SET sync_requested_at = now()
    WHERE restaurante_id = v_restaurante
    RETURNING sync_requested_at INTO v_atual;

    RETURN v_atual;
END;
$$;

GRANT EXECUTE ON FUNCTION public.solicitar_sync_nfe() TO authenticated;
