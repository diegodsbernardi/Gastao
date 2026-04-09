import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Loader2, ChefHat, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export const Onboarding = () => {
    const { user, refreshMembro } = useAuth();
    const navigate = useNavigate();

    const [nome, setNome] = useState(
        (user?.user_metadata?.restaurant_name as string) ?? ''
    );
    const [cnpj, setCnpj] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!nome.trim()) return;

        setIsLoading(true);
        setError('');

        const { error: rpcError } = await supabase.rpc('create_restaurant', {
            p_nome: nome.trim(),
            p_cnpj: cnpj.trim() || null,
        });

        if (rpcError) {
            setError(rpcError.message ?? 'Erro ao criar restaurante');
            setIsLoading(false);
            return;
        }

        await refreshMembro();
        navigate('/');
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md">

                {/* Header */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4 shadow-lg">
                        <Package className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900">Bem-vindo ao TOCS CRM</h1>
                    <p className="text-slate-500 mt-1">Vamos configurar o seu restaurante</p>
                </div>

                {/* Card */}
                <div className="bg-white rounded-2xl shadow-lg p-8">
                    <div className="flex items-start gap-3 mb-6 p-4 bg-blue-50 rounded-xl">
                        <ChefHat className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                        <p className="text-sm text-blue-700">
                            Você será o <strong>dono</strong> deste restaurante e poderá convidar sua equipe depois.
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                Nome do Restaurante <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={nome}
                                onChange={e => setNome(e.target.value)}
                                placeholder="Ex: Burguer do João"
                                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 placeholder-slate-400"
                                required
                                autoFocus
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                CNPJ{' '}
                                <span className="text-slate-400 font-normal">(opcional)</span>
                            </label>
                            <input
                                type="text"
                                value={cnpj}
                                onChange={e => setCnpj(e.target.value)}
                                placeholder="00.000.000/0000-00"
                                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 placeholder-slate-400"
                            />
                        </div>

                        {error && (
                            <p className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg">
                                {error}
                            </p>
                        )}

                        <button
                            type="submit"
                            disabled={isLoading || !nome.trim()}
                            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Criando restaurante...
                                </>
                            ) : (
                                'Criar Restaurante'
                            )}
                        </button>
                    </form>
                </div>

                <div className="flex flex-col items-center gap-2 mt-6">
                    <p className="text-xs text-slate-400">{user?.email}</p>
                    <button
                        onClick={async () => { await supabase.auth.signOut(); navigate('/login'); }}
                        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        <LogOut className="w-3.5 h-3.5" />
                        Já tenho conta — fazer login com outro email
                    </button>
                </div>
            </div>
        </div>
    );
};
