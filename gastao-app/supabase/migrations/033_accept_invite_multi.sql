-- =============================================================
-- Migration 033 — accept_invite aceita TODOS os convites do e-mail
--
-- Gap do fluxo BPO: a Cinco é convidada pra N restaurantes, mas a tela de
-- convite pendente só aparece pra quem NÃO tem membership — depois de aceitar
-- o 1º convite, os demais ficavam 'pendente' pra sempre. Agora aceitar um
-- convite aceita todos os pendentes do mesmo e-mail (todos partiram de donos
-- legítimos), e o restaurante ativo vira o do convite clicado.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.accept_invite(p_convite_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_convite public.convites%ROWTYPE;
    v_user_id uuid := auth.uid();
    v_email   text := auth.email();
BEGIN
    SELECT * INTO v_convite
    FROM public.convites
    WHERE id = p_convite_id
      AND LOWER(email) = LOWER(v_email)
      AND status = 'pendente';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Convite não encontrado ou já utilizado';
    END IF;

    -- Aceita TODOS os convites pendentes deste e-mail (multi-restaurante/BPO)
    INSERT INTO public.membros (usuario_id, restaurante_id, perfil)
    SELECT v_user_id, c.restaurante_id, c.perfil
    FROM public.convites c
    WHERE LOWER(c.email) = LOWER(v_email)
      AND c.status = 'pendente'
    ON CONFLICT DO NOTHING;

    UPDATE public.convites
    SET status = 'aceito'
    WHERE LOWER(email) = LOWER(v_email)
      AND status = 'pendente';

    -- Ativo = restaurante do convite clicado (legado + coluna nova)
    UPDATE public.profiles
    SET restaurant_id       = v_convite.restaurante_id,
        restaurante_ativo_id = v_convite.restaurante_id
    WHERE id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_invite(uuid) TO authenticated;

COMMIT;
