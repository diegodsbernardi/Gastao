import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type Perfil = 'dono' | 'gerente' | 'funcionario';

interface AuthContextType {
    session: Session | null;
    user: User | null;
    signOut: () => Promise<void>;
    isLoading: boolean;
    restauranteId: string | null;
    perfil: Perfil | null;
    nomeRestaurante: string | null;
    brandColor: string | null;
    logoUrl: string | null;
    refreshMembro: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    session: null,
    user: null,
    signOut: async () => {},
    isLoading: true,
    restauranteId: null,
    perfil: null,
    nomeRestaurante: null,
    brandColor: null,
    logoUrl: null,
    refreshMembro: async () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [session, setSession] = useState<Session | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [restauranteId, setRestauranteId] = useState<string | null>(null);
    const [perfil, setPerfil] = useState<Perfil | null>(null);
    const [nomeRestaurante, setNomeRestaurante] = useState<string | null>(null);
    const [brandColor, setBrandColor] = useState<string | null>(null);
    const [logoUrl, setLogoUrl] = useState<string | null>(null);
    const initializedRef = useRef(false);

    const clearMembro = () => {
        setRestauranteId(null);
        setPerfil(null);
        setNomeRestaurante(null);
        setBrandColor(null);
        setLogoUrl(null);
    };

    // fetchMembro é chamado FORA do onAuthStateChange para evitar deadlock
    const fetchMembro = async (currentUser: User) => {
        try {
            const { data: rows } = await supabase.rpc('get_my_membership');
            if (rows && rows.length > 0) {
                const m = rows[0];
                setRestauranteId(m.restaurante_id);
                setPerfil(m.perfil as Perfil);
                setNomeRestaurante(m.restaurante_nome);
                setBrandColor(m.brand_color ?? '#2563eb');
                setLogoUrl(m.logo_url ?? null);
                return;
            }

            // Verifica convite pendente
            const { data: convites } = await supabase
                .from('convites')
                .select('id')
                .eq('status', 'pendente')
                .ilike('email', currentUser.email ?? '')
                .limit(1);

            if (convites && convites.length > 0) {
                const { error } = await supabase.rpc('accept_invite', {
                    p_convite_id: convites[0].id,
                });
                if (!error) {
                    const { data: newRows } = await supabase.rpc('get_my_membership');
                    if (newRows && newRows.length > 0) {
                        const m = newRows[0];
                        setRestauranteId(m.restaurante_id);
                        setPerfil(m.perfil as Perfil);
                        setNomeRestaurante(m.restaurante_nome);
                        setBrandColor(m.brand_color ?? '#2563eb');
                        setLogoUrl(m.logo_url ?? null);
                        return;
                    }
                }
            }

            clearMembro();
        } catch {
            clearMembro();
        }
    };

    const refreshMembro = async () => {
        if (user) await fetchMembro(user);
    };

    useEffect(() => {
        let mounted = true;

        // ── Carga inicial via getSession (NÃO usa onAuthStateChange para evitar deadlock)
        const loadInitial = async () => {
            const { data: { session: s } } = await supabase.auth.getSession();
            if (!mounted) return;
            setSession(s);
            setUser(s?.user ?? null);
            if (s?.user) await fetchMembro(s.user);
            initializedRef.current = true;
            if (mounted) setIsLoading(false);
        };

        loadInitial();

        // ── Eventos subsequentes (login, logout, token refresh)
        // NÃO usar async/await direto aqui — causa deadlock no Supabase JS
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
            if (!mounted) return;

            if (event === 'SIGNED_IN') {
                // Se ainda estamos na carga inicial, ignora (loadInitial cuida disso)
                if (!initializedRef.current) return;

                setSession(s);
                setUser(s?.user ?? null);
                // setTimeout desacopla a chamada Supabase do callback do onAuthStateChange
                if (s?.user) {
                    const u = s.user;
                    setTimeout(() => { if (mounted) fetchMembro(u); }, 0);
                }

            } else if (event === 'SIGNED_OUT') {
                setSession(null);
                setUser(null);
                clearMembro();

            } else if (event === 'TOKEN_REFRESHED' && s) {
                setSession(s);
            }
        });

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, []);

    const signOut = async () => {
        await supabase.auth.signOut();
    };

    return (
        <AuthContext.Provider value={{
            session,
            user,
            signOut,
            isLoading,
            restauranteId,
            perfil,
            nomeRestaurante,
            brandColor,
            logoUrl,
            refreshMembro,
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
