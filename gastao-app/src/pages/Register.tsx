import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Package, UtensilsCrossed, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';

export const Register = () => {
    const [fullName, setFullName] = useState('');
    const [restaurantName, setRestaurantName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<boolean>(false);

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName,
                    restaurant_name: restaurantName,
                }
            }
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
                    <div className="bg-indigo-600 p-3 rounded-xl shadow-lg shadow-indigo-200">
                        <UtensilsCrossed className="w-10 h-10 text-white" />
                    </div>
                    <h2 className="mt-6 text-center text-3xl font-extrabold text-slate-900">
                        Criar sua Conta Master
                    </h2>
                    <p className="mt-2 text-center text-sm text-slate-600">
                        Cadastre seu restaurante e controle sua Ficha Técnica
                    </p>
                </div>

                <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                    <div className="bg-white py-8 px-4 shadow-xl shadow-slate-200/50 sm:rounded-2xl sm:px-10 border border-slate-200">
                        {success ? (
                            <div className="text-center">
                                <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Package className="w-8 h-8" />
                                </div>
                                <h3 className="text-xl font-bold text-slate-900">Conta Criada!</h3>
                                <p className="text-slate-500 mt-2">
                                    Seu restaurante foi construído no banco de dados.
                                    Verifique seu e-mail para confirmar a conta, ou clique abaixo para fazer Login (se a confirmação de email estiver desativada no seu banco).
                                </p>
                                <Link to="/login" className="mt-6 w-full flex justify-center py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700">
                                    Ir para o Login
                                </Link>
                            </div>
                        ) : (
                            <form className="space-y-5" onSubmit={handleRegister}>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700">Seu Nome</label>
                                    <input type="text" required value={fullName} onChange={e => setFullName(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" placeholder="Ex: Diego" />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700">Nome do Restaurante</label>
                                    <input type="text" required value={restaurantName} onChange={e => setRestaurantName(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" placeholder="Ex: TOCS Burguer" />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700">E-mail</label>
                                    <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700">Senha Segura</label>
                                    <input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                                </div>

                                {error && (
                                    <div className="text-red-500 text-sm font-medium bg-red-50 p-3 rounded-md border border-red-100">
                                        {error}
                                    </div>
                                )}

                                <div>
                                    <button type="submit" disabled={loading} className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 transition-all">
                                        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Criar Conta e Restaurante'}
                                    </button>
                                </div>
                            </form>
                        )}

                        {!success && (
                            <div className="mt-6 text-center">
                                <p className="text-sm text-slate-600">
                                    Já possui conta? <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-500">Faça Login</Link>
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
