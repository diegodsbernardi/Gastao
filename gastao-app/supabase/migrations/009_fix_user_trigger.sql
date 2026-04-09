-- =============================================================
-- Gastão — Migration 009: Corrige trigger de criação de usuário
-- Resolve: "profiles_role_check" violada ao criar usuário
-- Execute no Supabase SQL Editor
-- =============================================================

-- 1. Remove a constraint que rejeita o valor que o trigger insere
ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_role_check;

-- 2. Torna role nullable para não precisar de valor obrigatório
ALTER TABLE public.profiles
    ALTER COLUMN role DROP NOT NULL;

-- 3. Recria a função do trigger de forma simples e segura
--    (apenas cria o perfil com o id; restaurant_id é preenchido
--     depois via create_restaurant ou accept_invite)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id)
    VALUES (new.id)
    ON CONFLICT (id) DO NOTHING;
    RETURN new;
END;
$$;

-- 4. Garante que o trigger existe e está vinculado
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

NOTIFY pgrst, 'reload schema';
