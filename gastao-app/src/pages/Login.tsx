import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { ChefHat, Loader2, Eye, EyeOff } from 'lucide-react';
import { Link } from 'react-router-dom';

const translateError = (msg: string): string => {
    if (msg.includes('Invalid login credentials')) return 'Email ou senha inválidos.';
    if (msg.includes('Email not confirmed')) return 'Email não confirmado. Verifique sua caixa de entrada.';
    if (msg.includes('Too many requests')) return 'Muitas tentativas. Aguarde alguns minutos.';
    if (msg.includes('User not found')) return 'Usuário não encontrado.';
    if (msg.includes('Invalid email')) return 'Email inválido.';
    return 'Ocorreu um erro. Tente novamente.';
};

export const Login = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            setError(translateError(error.message));
        }
        setLoading(false);
    };

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <div className="flex justify-center flex-col items-center">
                    <div className="bg-primary-600 p-3 rounded-xl">
                        <ChefHat className="w-10 h-10 text-white" />
                    </div>
                    <h2 className="mt-6 text-center text-3xl font-extrabold text-ink">
                        Bem-vindo de volta
                    </h2>
                    <p className="mt-2 text-center text-sm text-warm-gray">
                        Inteligência operacional para seu restaurante
                    </p>
                </div>

                <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                    <div className="bg-white py-8 px-4 shadow sm:rounded-2xl sm:px-10 border border-slate-200">
                        <form className="space-y-6" onSubmit={handleLogin}>
                            <div>
                                <label htmlFor="email" className="block text-sm font-medium text-slate-700">
                                    Email
                                </label>
                                <div className="mt-1">
                                    <input
                                        id="email"
                                        type="email"
                                        required
                                        autoComplete="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="appearance-none block w-full px-3 py-2 border border-slate-300 rounded-xl shadow-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                                    />
                                </div>
                            </div>

                            <div>
                                <div className="flex items-center justify-between">
                                    <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                                        Senha
                                    </label>
                                    <div className="text-sm">
                                        <Link to="/reset-password" className="font-medium text-primary-600 hover:text-primary-500">
                                            Esqueci a senha?
                                        </Link>
                                    </div>
                                </div>
                                <div className="mt-1 relative">
                                    <input
                                        id="password"
                                        type={showPassword ? 'text' : 'password'}
                                        required
                                        autoComplete="current-password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="appearance-none block w-full px-3 py-2 pr-10 border border-slate-300 rounded-xl shadow-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(v => !v)}
                                        aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                                        className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-r-xl"
                                    >
                                        {showPassword
                                            ? <EyeOff className="w-4 h-4" />
                                            : <Eye className="w-4 h-4" />
                                        }
                                    </button>
                                </div>
                            </div>

                            {error && (
                                <div role="alert" className="text-red-600 text-sm font-medium bg-red-50 p-3 rounded-xl border border-red-100">
                                    {error}
                                </div>
                            )}

                            <div>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                >
                                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Entrar na Conta'}
                                </button>
                            </div>
                        </form>

                        <div className="mt-6 text-center">
                            <p className="text-sm text-slate-600">
                                Ainda não possui conta? <Link to="/register" className="font-medium text-primary-600 hover:text-primary-500">Criar Restaurante</Link>
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
