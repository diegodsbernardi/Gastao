import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Package, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const UpdatePassword = () => {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const navigate = useNavigate();

    // After reset link is clicked, the user is redirected here.
    // They will be automatically logged in by Supabase with a special session or we just update the password.

    // We should ensure the user is logged in via the token hash before allowing update,
    // but the Supabase client handles parsing the token from the URL automatically in most setups. 
    // We'll just call updateUser.

    useEffect(() => {
        // If the user lands here, we should make sure we process the implicitly passed hash token 
        // via Supabase's auth state listener (handled globally usually via context),
        // but let's just render the form.
    }, []);

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();

        if (password !== confirmPassword) {
            setError("As senhas não coincidem");
            return;
        }

        setLoading(true);
        setError(null);

        const { error } = await supabase.auth.updateUser({
            password: password
        });

        if (error) {
            setError(error.message);
        } else {
            // Updated successfully, go to dashboard
            navigate('/');
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
                        Atualizar Senha
                    </h2>
                    <p className="mt-2 text-center text-sm text-slate-600">
                        Digite sua nova senha abaixo
                    </p>
                </div>

                <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                    <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200">
                        <form className="space-y-6" onSubmit={handleUpdate}>
                            <div>
                                <label className="block text-sm font-medium text-slate-700">
                                    Nova Senha
                                </label>
                                <div className="mt-1">
                                    <input
                                        type="password"
                                        required
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="appearance-none block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700">
                                    Confirmar Nova Senha
                                </label>
                                <div className="mt-1">
                                    <input
                                        type="password"
                                        required
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        className="appearance-none block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                    />
                                </div>
                            </div>

                            {error && (
                                <div className="text-red-500 text-sm font-medium bg-red-50 p-3 rounded-md border border-red-100">
                                    {error}
                                </div>
                            )}

                            <div>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                >
                                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Atualizar a Senha'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
};
