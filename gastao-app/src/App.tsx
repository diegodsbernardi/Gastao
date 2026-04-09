import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { ResetPassword } from './pages/ResetPassword';
import { UpdatePassword } from './pages/UpdatePassword';
import { Recipes } from './pages/Recipes';
import { Ingredients } from './pages/Ingredients';
import { Sales } from './pages/Sales';
import { Onboarding } from './pages/Onboarding';
import { Equipe } from './pages/Equipe';
import { NotasFiscais } from './pages/NotasFiscais';
import { Preparos } from './pages/Preparos';
import { AuthProvider, useAuth, Perfil } from './contexts/AuthContext';
import { Loader2 } from 'lucide-react';

// Spinner de tela cheia
const FullScreenLoader = () => (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
    </div>
);

// Rota privada: exige sessão + restaurante configurado
const PrivateRoute = ({ children }: { children: React.ReactNode }) => {
    const { session, isLoading, restauranteId } = useAuth();

    if (isLoading) return <FullScreenLoader />;
    if (!session) return <Navigate to="/login" replace />;
    if (!restauranteId) return <Navigate to="/onboarding" replace />;

    return <Layout>{children}</Layout>;
};

// Rota de onboarding: exige sessão mas SEM restaurante
const OnboardingRoute = () => {
    const { session, isLoading, restauranteId } = useAuth();

    if (isLoading) return <FullScreenLoader />;
    if (!session) return <Navigate to="/login" replace />;
    if (restauranteId) return <Navigate to="/" replace />;

    return <Onboarding />;
};

// Rota com restrição de perfil
const RoleRoute = ({
    children,
    allowed,
}: {
    children: React.ReactNode;
    allowed: Perfil[];
}) => {
    const { perfil } = useAuth();
    if (!perfil || !allowed.includes(perfil)) return <Navigate to="/" replace />;
    return <>{children}</>;
};

function AppRoutes() {
    const { session, isLoading, restauranteId } = useAuth();

    // Enquanto carrega, não renderiza nenhuma rota pública
    if (isLoading) return <FullScreenLoader />;

    const redirectIfAuth = session
        ? (restauranteId ? <Navigate to="/" replace /> : <Navigate to="/onboarding" replace />)
        : null;

    return (
        <Routes>
            {/* Rotas públicas */}
            <Route path="/login"          element={redirectIfAuth ?? <Login />} />
            <Route path="/register"       element={redirectIfAuth ?? <Register />} />
            <Route path="/reset-password" element={redirectIfAuth ?? <ResetPassword />} />
            <Route path="/update-password" element={<UpdatePassword />} />

            {/* Onboarding (sessão obrigatória, sem restaurante) */}
            <Route path="/onboarding" element={<OnboardingRoute />} />

            {/* Rotas privadas */}
            <Route
                path="/*"
                element={
                    <PrivateRoute>
                        <Routes>
                            <Route path="/" element={<Dashboard />} />
                            <Route
                                path="/ingredients"
                                element={
                                    <RoleRoute allowed={['dono', 'gerente']}>
                                        <Ingredients />
                                    </RoleRoute>
                                }
                            />
                            <Route path="/preparos" element={<Preparos />} />
                            <Route
                                path="/recipes"
                                element={
                                    <RoleRoute allowed={['dono', 'gerente']}>
                                        <Recipes />
                                    </RoleRoute>
                                }
                            />
                            <Route
                                path="/sales"
                                element={
                                    <RoleRoute allowed={['dono', 'gerente']}>
                                        <Sales />
                                    </RoleRoute>
                                }
                            />
                            <Route
                                path="/notas-fiscais"
                                element={
                                    <RoleRoute allowed={['dono', 'gerente']}>
                                        <NotasFiscais />
                                    </RoleRoute>
                                }
                            />
                            <Route
                                path="/equipe"
                                element={
                                    <RoleRoute allowed={['dono', 'gerente']}>
                                        <Equipe />
                                    </RoleRoute>
                                }
                            />
                        </Routes>
                    </PrivateRoute>
                }
            />
        </Routes>
    );
}

function App() {
    return (
        <AuthProvider>
            <Router>
                <AppRoutes />
            </Router>
            <Toaster position="top-right" richColors closeButton />
        </AuthProvider>
    );
}

export default App;
