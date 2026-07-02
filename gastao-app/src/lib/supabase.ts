import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase URL ou Anon Key não configurados no .env.local');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        // Refresha o token automaticamente (sessões longas não caem). A proteção
        // contra re-render que desmonta modais fica no handler de TOKEN_REFRESHED
        // do AuthContext, não em desligar o refresh.
        autoRefreshToken: true,
        detectSessionInUrl: true,
    },
});
