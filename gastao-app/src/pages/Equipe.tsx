import React, { useEffect, useState } from 'react';
import { Users, UserPlus, Trash2, Loader2, Mail, Crown, Shield, User, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';

interface Membro {
    id: string;
    usuario_id: string;
    email: string;
    nome: string;
    perfil: 'dono' | 'gerente' | 'funcionario';
    criado_em: string;
}

const PERFIL_CONFIG = {
    dono:        { label: 'Dono',        color: 'text-primary-700 bg-primary-100',   Icon: Crown  },
    gerente:     { label: 'Gerente',     color: 'text-amber-700 bg-amber-100', Icon: Shield },
    funcionario: { label: 'Funcionário', color: 'text-slate-600 bg-slate-100', Icon: User   },
} as const;

export const Equipe = () => {
    const { user, restauranteId } = useAuth();
    const { isDono } = usePermissions();

    const [membros, setMembros] = useState<Membro[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [removingId, setRemovingId] = useState<string | null>(null);

    // Modal de convite
    const [showModal, setShowModal] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [invitePerfil, setInvitePerfil] = useState<'gerente' | 'funcionario'>('funcionario');
    const [isInviting, setIsInviting] = useState(false);
    const [inviteError, setInviteError] = useState('');
    const [inviteSuccess, setInviteSuccess] = useState(false);

    const fetchMembros = async () => {
        const { data } = await supabase.rpc('get_restaurant_members');
        if (data) setMembros(data as Membro[]);
        setIsLoading(false);
    };

    useEffect(() => {
        fetchMembros();
    }, []);

    const handleRemove = async (membro: Membro) => {
        if (!confirm(`Remover ${membro.nome || membro.email} da equipe?`)) return;
        setRemovingId(membro.id);
        await supabase.from('membros').delete().eq('id', membro.id);
        setMembros(prev => prev.filter(m => m.id !== membro.id));
        setRemovingId(null);
    };

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsInviting(true);
        setInviteError('');

        const email = inviteEmail.toLowerCase().trim();

        // Insere convite pendente
        const { error: conviteError } = await supabase.from('convites').insert({
            email,
            restaurante_id: restauranteId,
            perfil: invitePerfil,
            convidado_por: user?.id,
        });

        if (conviteError) {
            setInviteError(conviteError.message ?? 'Erro ao criar convite');
            setIsInviting(false);
            return;
        }

        // Envia magic link para o email convidado
        await supabase.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: true },
        });

        setIsInviting(false);
        setInviteSuccess(true);
    };

    const closeModal = () => {
        setShowModal(false);
        setInviteEmail('');
        setInviteError('');
        setInviteSuccess(false);
        setInvitePerfil('funcionario');
    };

    return (
        <div className="max-w-4xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Equipe</h1>
                    <p className="text-slate-500 text-sm mt-0.5">
                        {membros.length} {membros.length === 1 ? 'membro' : 'membros'}
                    </p>
                </div>
                {isDono && (
                    <button
                        onClick={() => setShowModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium transition-colors"
                    >
                        <UserPlus className="w-4 h-4" />
                        Convidar
                    </button>
                )}
            </div>

            {/* Tabela de membros */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                {isLoading ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
                    </div>
                ) : membros.length === 0 ? (
                    <div className="text-center py-16">
                        <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                        <p className="text-slate-500 font-medium">Nenhum membro ainda</p>
                        {isDono && (
                            <p className="text-slate-400 text-sm mt-1">
                                Clique em "Convidar" para adicionar alguém
                            </p>
                        )}
                    </div>
                ) : (
                    <table className="w-full">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                    Membro
                                </th>
                                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                    Perfil
                                </th>
                                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">
                                    Desde
                                </th>
                                {isDono && <th className="px-6 py-3 w-14" />}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {membros.map(membro => {
                                const cfg = PERFIL_CONFIG[membro.perfil] ?? PERFIL_CONFIG.funcionario;
                                const isSelf = membro.usuario_id === user?.id;
                                return (
                                    <tr key={membro.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center font-bold text-sm shrink-0">
                                                    {(membro.nome || membro.email)[0].toUpperCase()}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="font-medium text-slate-900 text-sm truncate">
                                                        {membro.nome || membro.email}
                                                    </p>
                                                    <p className="text-xs text-slate-400 truncate">
                                                        {membro.email}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.color}`}>
                                                <cfg.Icon className="w-3 h-3" />
                                                {cfg.label}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-slate-500 hidden sm:table-cell">
                                            {new Date(membro.criado_em).toLocaleDateString('pt-BR')}
                                        </td>
                                        {isDono && (
                                            <td className="px-6 py-4 text-right">
                                                {!isSelf && (
                                                    <button
                                                        onClick={() => handleRemove(membro)}
                                                        disabled={removingId === membro.id}
                                                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                                        title="Remover membro"
                                                    >
                                                        {removingId === membro.id
                                                            ? <Loader2 className="w-4 h-4 animate-spin" />
                                                            : <Trash2 className="w-4 h-4" />
                                                        }
                                                    </button>
                                                )}
                                            </td>
                                        )}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Modal de Convite */}
            {showModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
                    onClick={e => { if (e.target === e.currentTarget) closeModal(); }}
                >
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
                        {/* Header do modal */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                            <h2 className="text-lg font-semibold text-slate-900">
                                Convidar para a equipe
                            </h2>
                            <button
                                onClick={closeModal}
                                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6">
                            {inviteSuccess ? (
                                /* Estado de sucesso */
                                <div className="text-center py-4">
                                    <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                        <Mail className="w-6 h-6 text-green-600" />
                                    </div>
                                    <p className="font-semibold text-slate-900">Convite enviado!</p>
                                    <p className="text-sm text-slate-500 mt-1">
                                        Um link de acesso foi enviado para{' '}
                                        <strong>{inviteEmail}</strong>.
                                    </p>
                                    <button
                                        onClick={closeModal}
                                        className="mt-5 px-6 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors"
                                    >
                                        Fechar
                                    </button>
                                </div>
                            ) : (
                                /* Formulário de convite */
                                <form onSubmit={handleInvite} className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                            Email
                                        </label>
                                        <input
                                            type="email"
                                            value={inviteEmail}
                                            onChange={e => setInviteEmail(e.target.value)}
                                            placeholder="funcionario@email.com"
                                            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-slate-900 placeholder-slate-400"
                                            required
                                            autoFocus
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                            Perfil de acesso
                                        </label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {(['gerente', 'funcionario'] as const).map(p => {
                                                const cfg = PERFIL_CONFIG[p];
                                                return (
                                                    <button
                                                        key={p}
                                                        type="button"
                                                        onClick={() => setInvitePerfil(p)}
                                                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-colors ${
                                                            invitePerfil === p
                                                                ? 'border-primary-500 bg-primary-50 text-primary-700'
                                                                : 'border-slate-200 text-slate-600 hover:border-slate-300'
                                                        }`}
                                                    >
                                                        <cfg.Icon className="w-4 h-4" />
                                                        {cfg.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <p className="text-xs text-slate-400 mt-2">
                                            {invitePerfil === 'gerente'
                                                ? 'Acesso ao dashboard, insumos, fichas e vendas. Pode ver a equipe.'
                                                : 'Acesso limitado. Expandido nas próximas versões.'
                                            }
                                        </p>
                                    </div>

                                    {inviteError && (
                                        <p className="text-sm text-red-600 bg-red-50 px-3 py-2.5 rounded-lg">
                                            {inviteError}
                                        </p>
                                    )}

                                    <div className="flex gap-3 pt-1">
                                        <button
                                            type="button"
                                            onClick={closeModal}
                                            className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-medium hover:bg-slate-50 transition-colors"
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={isInviting || !inviteEmail.trim()}
                                            className="flex-1 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 disabled:cursor-not-allowed text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                                        >
                                            {isInviting
                                                ? <><Loader2 className="w-4 h-4 animate-spin" /> Enviando...</>
                                                : 'Enviar Convite'
                                            }
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
