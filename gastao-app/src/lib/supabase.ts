import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase URL ou Anon Key não configurados no .env.local');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        // Não refresha o token automaticamente quando a aba volta ao foco
        // Evita re-renders que desmontam modais abertos
        autoRefreshToken: true,
        detectSessionInUrl: true,
    },
});
