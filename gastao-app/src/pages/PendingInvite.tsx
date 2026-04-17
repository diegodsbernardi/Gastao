import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Check, X, Loader2, LogOut, ChefHat } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

const PERFIL_LABEL: Record<string, string> = {
    dono: 'dono',
    gerente: 'gerente',
    funcionario: 'funcionário',
};

export const PendingInvite = () => {
    const { user, pendingInvite, acceptPendingInvite, rejectPendingInvite } = useAuth();
    const navigate = useNavigate();

    const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);
    const [error, setError] = useState('');

    if (!pendingInvite) {
        // Se cair aqui sem convite (ex: já aceito em outra aba), volta pra raiz e
        // deixa o roteador decidir o destino correto.
        navigate('/', { replace: true });
        return null;
    }

    const handleAccept = async () => {
        setBusy('accept');
        setError('');
        const { error } = await acceptPendingInvite();
        if (error) {
            setError(error);
            setBusy(null);
            return;
        }
        navigate('/', { replace: true });
    };

    const handleReject = async () => {
        setBusy('reject');
        setError('');
        const { error } = await rejectPendingInvite();
        if (error) {
            setError(error);
            setBusy(null);
            return;
        }
        navigate('/onboarding', { replace: true });
    };

    const perfilLabel = PERFIL_LABEL[pendingInvite.perfil] ?? pendingInvite.perfil;

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-primary-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-500 rounded-2xl mb-4 shadow-lg shadow-primary-200">
                        <ChefHat className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-ink">Você foi convidado!</h1>
                    <p className="text-warm-gray mt-1">Confirma se quer entrar nesta equipe.</p>
                </div>

                <div className="bg-white rounded-2xl shadow-lg p-8 border-t-4 border-primary-500">
                    <div className="flex items-start gap-3 mb-6 p-4 bg-primary-50 rounded-xl">
                        <Mail className="w-5 h-5 text-primary-600 shrink-0 mt-0.5" />
                        <div className="text-sm text-primary-900">
                            Convite para entrar em{' '}
                            <strong>{pendingInvite.restaurante_nome}</strong>{' '}
                            como <strong>{perfilLabel}</strong>.
                        </div>
                    </div>

                    {error && (
                        <p className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg mb-4">
                            {error}
                        </p>
                    )}

                    <div className="flex flex-col gap-3">
                        <button
                            onClick={handleAccept}
                            disabled={busy !== null}
                            className="w-full py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 disabled:cursor-not-allowed text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors"
                        >
                            {busy === 'accept' ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Check className="w-4 h-4" />
                            )}
                            Aceitar convite
                        </button>

                        <button
                            onClick={handleReject}
                            disabled={busy !== null}
                            className="w-full py-3 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:cursor-not-allowed text-slate-700 border border-slate-200 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                        >
                            {busy === 'reject' ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <X className="w-4 h-4" />
                            )}
                            Recusar
                        </button>
                    </div>
                </div>

                <div className="flex flex-col items-center gap-2 mt-6">
                    <p className="text-xs text-slate-400">{user?.email}</p>
                    <button
                        onClick={async () => { await supabase.auth.signOut(); navigate('/login'); }}
                        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        <LogOut className="w-3.5 h-3.5" />
                        Sair e entrar com outro email
                    </button>
                </div>
            </div>
        </div>
    );
};
