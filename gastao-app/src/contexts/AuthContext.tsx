import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type Perfil = 'dono' | 'gerente' | 'funcionario';

export interface PendingInvite {
    id: string;
    restaurante_nome: string;
    perfil: Perfil;
}

interface AuthContextType {
    session: Session | null;
    user: User | null;
    signOut: () => Promise<void>;
    isLoading: boolean;
    isFetchingMembro: boolean;
    restauranteId: string | null;
    perfil: Perfil | null;
    nomeRestaurante: string | null;
    brandColor: string | null;
    logoUrl: string | null;
    pendingInvite: PendingInvite | null;
    refreshMembro: () => Promise<void>;
    acceptPendingInvite: () => Promise<{ error?: string }>;
    rejectPendingInvite: () => Promise<{ error?: string }>;
}

const AuthContext = createContext<AuthContextType>({
    session: null,
    user: null,
    signOut: async () => {},
    isLoading: true,
    isFetchingMembro: false,
    restauranteId: null,
    perfil: null,
    nomeRestaurante: null,
    brandColor: null,
    logoUrl: null,
    pendingInvite: null,
    refreshMembro: async () => {},
    acceptPendingInvite: async () => ({}),
    rejectPendingInvite: async () => ({}),
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
    const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null);
    const [isFetchingMembro, setIsFetchingMembro] = useState(false);
    const initializedRef = useRef(false);

    const clearMembro = () => {
        setRestauranteId(null);
        setPerfil(null);
        setNomeRestaurante(null);
        setBrandColor(null);
        setLogoUrl(null);
        setPendingInvite(null);
    };

    // fetchMembro é chamado FORA do onAuthStateChange para evitar deadlock.
    // NUNCA aceita convite aqui — só LISTA convites pendentes pra UI mostrar
    // tela de consentimento explícito (ver acceptPendingInvite/rejectPendingInvite).
    const fetchMembro = async (currentUser: User) => {
        setIsFetchingMembro(true);
        try {
            const { data: rows } = await supabase.rpc('get_my_membership');
            if (rows && rows.length > 0) {
                const m = rows[0];
                setRestauranteId(m.restaurante_id);
                setPerfil(m.perfil as Perfil);
                setNomeRestaurante(m.restaurante_nome);
                setBrandColor(m.brand_color ?? '#FF6B35');
                setLogoUrl(m.logo_url ?? null);
                setPendingInvite(null);
                return;
            }

            // Sem membership — verifica se há convite pendente pro email
            const { data: convites } = await supabase
                .from('convites')
                .select('id, perfil, restaurantes!inner(nome)')
                .eq('status', 'pendente')
                .ilike('email', currentUser.email ?? '')
                .limit(1);

            if (convites && convites.length > 0) {
                const c = convites[0] as {
                    id: string;
                    perfil: Perfil;
                    restaurantes: { nome: string } | { nome: string }[];
                };
                const restNome = Array.isArray(c.restaurantes)
                    ? c.restaurantes[0]?.nome ?? ''
                    : c.restaurantes?.nome ?? '';
                setPendingInvite({
                    id: c.id,
                    restaurante_nome: restNome,
                    perfil: c.perfil,
                });
            } else {
                setPendingInvite(null);
            }

            setRestauranteId(null);
            setPerfil(null);
            setNomeRestaurante(null);
            setBrandColor(null);
            setLogoUrl(null);
        } catch {
            clearMembro();
        } finally {
            setIsFetchingMembro(false);
        }
    };

    const refreshMembro = async () => {
        if (user) await fetchMembro(user);
    };

    const acceptPendingInvite = async (): Promise<{ error?: string }> => {
        if (!pendingInvite || !user) return { error: 'Sem convite pendente' };
        const { error } = await supabase.rpc('accept_invite', {
            p_convite_id: pendingInvite.id,
        });
        if (error) return { error: error.message ?? 'Erro ao aceitar convite' };
        await fetchMembro(user);
        return {};
    };

    const rejectPendingInvite = async (): Promise<{ error?: string }> => {
        if (!pendingInvite || !user) return { error: 'Sem convite pendente' };
        const { error } = await supabase.rpc('reject_invite', {
            p_convite_id: pendingInvite.id,
        });
        if (error) return { error: error.message ?? 'Erro ao recusar convite' };
        await fetchMembro(user);
        return {};
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
                // setTimeout desacopla a chamada Supabase do callback do onAuthStateChange.
                // Marca isFetchingMembro=true JÁ pra fechar a janela de race em que
                // PrivateRoute veria restauranteId=null e redirecionaria pro onboarding
                // antes de fetchMembro resolver.
                if (s?.user) {
                    const u = s.user;
                    setIsFetchingMembro(true);
                    setTimeout(() => { if (mounted) fetchMembro(u); }, 0);
                }

            } else if (event === 'SIGNED_OUT') {
                setSession(null);
                setUser(null);
                clearMembro();

            } else if (event === 'TOKEN_REFRESHED' && s) {
                // Atualiza sessão silenciosamente via ref para não causar re-render
                // que desmontaria modais abertos (ex: importador de fichas)
                setSession(prev => {
                    if (prev?.access_token === s.access_token) return prev;
                    return s;
                });
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
            isFetchingMembro,
            restauranteId,
            perfil,
            nomeRestaurante,
            brandColor,
            logoUrl,
            pendingInvite,
            refreshMembro,
            acceptPendingInvite,
            rejectPendingInvite,
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
