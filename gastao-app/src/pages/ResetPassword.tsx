import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Package, Loader2, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export const ResetPassword = () => {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const handleReset = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSuccess(false);

        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/update-password`,
        });

        if (error) {
            setError(error.message);
        } else {
            setSuccess(true);
        }
        setLoading(false);
    };

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <div className="flex justify-center flex-col items-center">
                    <div className="bg-blue-600 p-3 rounded-xl">
                        <Package className="w-10 h-10 text-white" />
                    </div>
                    <h2 className="mt-6 text-center text-3xl font-extrabold text-slate-900">
                        Redefinir Senha
                    </h2>
                    <p className="mt-2 text-center text-sm text-slate-600">
                        Insira seu e-mail para receber um link de recuperação
                    </p>
                </div>

                <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                    <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200">
                        <form className="space-y-6" onSubmit={handleReset}>
                            <div>
                                <label className="block text-sm font-medium text-slate-700">
                                    Email
                                </label>
                                <div className="mt-1">
                                    <input
                                        type="email"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="appearance-none block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                    />
                                </div>
                            </div>

                            {error && (
                                <div className="text-red-500 text-sm font-medium bg-red-50 p-3 rounded-md border border-red-100">
                                    {error}
                                </div>
                            )}

                            {success && (
                                <div className="text-green-600 text-sm font-medium bg-green-50 p-3 rounded-md border border-green-100">
                                    Link de recuperação enviado com sucesso! Verifique seu e-mail.
                                </div>
                            )}

                            <div>
                                <button
                                    type="submit"
                                    disabled={loading || success}
                                    className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                >
                                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Enviar Link de Recuperação'}
                                </button>
                            </div>
                        </form>

                        <div className="mt-6 text-center">
                            <Link to="/login" className="flex items-center justify-center text-sm font-medium text-slate-600 hover:text-slate-900">
                                <ArrowLeft className="w-4 h-4 mr-2" />
                                Voltar para o Login
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
