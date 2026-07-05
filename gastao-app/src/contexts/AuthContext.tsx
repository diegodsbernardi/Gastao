import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type Perfil = 'dono' | 'gerente' | 'funcionario' | 'bpo';

export interface Membership {
    membro_id: string;
    restaurante_id: string;
    restaurante_nome: string;
    bpo_id: string | null;
    bpo_nome: string | null;
    perfil: Perfil;
    eh_ativo: boolean;
    brand_color: string | null;
}

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
    memberships: Membership[];
    switchRestaurante: (restauranteId: string) => Promise<void>;
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
    memberships: [],
    switchRestaurante: async () => {},
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
    const [memberships, setMemberships] = useState<Membership[]>([]);
    const [isFetchingMembro, setIsFetchingMembro] = useState(false);
    const initializedRef = useRef(false);
    // Rastreia qual user.id já carregamos. Supabase re-emite SIGNED_IN em
    // visibilitychange/reconexão mesmo quando o user não mudou — se o id
    // bate com o ref, evitamos re-fetch que unmountaria o importador.
    const currentUserIdRef = useRef<string | null>(null);

    const clearMembro = () => {
        setRestauranteId(null);
        setPerfil(null);
        setNomeRestaurante(null);
        setBrandColor(null);
        setLogoUrl(null);
        setPendingInvite(null);
        setMemberships([]);
    };

    // fetchMembro é chamado FORA do onAuthStateChange para evitar deadlock.
    // NUNCA aceita convite aqui — só LISTA convites pendentes pra UI mostrar
    // tela de consentimento explícito (ver acceptPendingInvite/rejectPendingInvite).
    const fetchMembro = async (currentUser: User) => {
        setIsFetchingMembro(true);
        try {
            const [{ data: rows, error: membershipError }, { data: allRows }] = await Promise.all([
                supabase.rpc('get_my_membership'),
                supabase.rpc('get_my_memberships'),
            ]);
            setMemberships((allRows ?? []) as Membership[]);
            if (membershipError) {
                // Erro transiente (rede/timeout): mantém o estado anterior em vez de
                // zerar a membership — senão um dono válido cairia no onboarding.
                console.warn('get_my_membership falhou, mantendo estado:', membershipError.message);
                return;
            }
            if (rows && rows.length > 0) {
                const m = rows[0];
                setRestauranteId(m.restaurante_id);
                setPerfil(m.perfil as Perfil);
                setNomeRestaurante(m.restaurante_nome);
                // White-label: identidade do BPO tem precedência sobre a do restaurante
                setBrandColor(m.bpo_cor ?? m.brand_color ?? '#FF6B35');
                setLogoUrl(m.bpo_logo ?? m.logo_url ?? null);
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
        } catch (e) {
            // Exceção de rede: preserva o estado anterior (não desloga do restaurante).
            console.warn('fetchMembro exceção, mantendo estado:', e);
        } finally {
            setIsFetchingMembro(false);
        }
    };

    const refreshMembro = async () => {
        if (user) await fetchMembro(user);
    };

    // Troca o restaurante ativo e recarrega a página inteira: as telas usam
    // useEffect local sem cache compartilhado — reload garante zero vazamento
    // de estado entre tenants.
    const switchRestaurante = async (id: string) => {
        const { error } = await supabase.rpc('switch_restaurante', { p_restaurante_id: id });
        if (error) throw new Error(error.message ?? 'Erro ao trocar de restaurante');
        window.location.assign('/');
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
            if (s?.user) {
                currentUserIdRef.current = s.user.id;
                await fetchMembro(s.user);
            }
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

                // Supabase re-emite SIGNED_IN em visibilitychange (alt-tab, troca
                // de aba) mesmo quando o user não mudou. Nesse caso, só atualiza
                // a session — não re-dispara fetchMembro, porque isso setaria
                // isFetchingMembro=true e unmountaria componentes em andamento
                // (importador de fichas, formulários, etc).
                const sameUser = s?.user?.id && s.user.id === currentUserIdRef.current;
                setSession(s);
                setUser(s?.user ?? null);
                if (s?.user && !sameUser) {
                    const u = s.user;
                    currentUserIdRef.current = u.id;
                    setIsFetchingMembro(true);
                    setTimeout(() => { if (mounted) fetchMembro(u); }, 0);
                }

            } else if (event === 'SIGNED_OUT') {
                currentUserIdRef.current = null;
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
            memberships,
            switchRestaurante,
            refreshMembro,
            acceptPendingInvite,
            rejectPendingInvite,
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
