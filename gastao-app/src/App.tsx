import React, { Suspense } from 'react';
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
import { PendingInvite } from './pages/PendingInvite';
import { Equipe } from './pages/Equipe';
import { NotasFiscais } from './pages/NotasFiscais';
import { Preparos } from './pages/Preparos';
import { Checklists } from './pages/Checklists';
import { Feedbacks } from './pages/Feedbacks';
import { AuthProvider, useAuth, Perfil } from './contexts/AuthContext';
import { Loader2 } from 'lucide-react';

// Lazy load do importador de fichas: SheetJS (xlsx) é pesado (~400KB)
// e só é usado por dono/gerente no desktop. Sai do bundle inicial pra
// que tablet/celular não baixem código que nunca vão usar.
const ImportarFichaTecnica = React.lazy(() =>
    import('./pages/ImportarFichaTecnica').then(m => ({ default: m.ImportarFichaTecnica }))
);

// Spinner de tela cheia
const FullScreenLoader = () => (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
    </div>
);

// Rota privada: exige sessão + restaurante configurado
const PrivateRoute = ({ children }: { children: React.ReactNode }) => {
    const { session, isLoading, isFetchingMembro, restauranteId, pendingInvite } = useAuth();

    // Só bloqueia render quando não temos nada carregado. Re-fetches em
    // background (ex: membro sendo atualizado) não devem desmontar children
    // — isso destruiria state de componentes em andamento (importador, etc).
    if (isLoading) return <FullScreenLoader />;
    if (!session) return <Navigate to="/login" replace />;
    if (isFetchingMembro && !restauranteId) return <FullScreenLoader />;
    if (!restauranteId) {
        return <Navigate to={pendingInvite ? '/convite-pendente' : '/onboarding'} replace />;
    }

    return <Layout>{children}</Layout>;
};

// Rota de onboarding: exige sessão SEM restaurante e SEM convite pendente
// (se tem convite, a tela dedicada de aceitar/recusar tem prioridade)
const OnboardingRoute = () => {
    const { session, isLoading, isFetchingMembro, restauranteId, pendingInvite } = useAuth();

    if (isLoading || isFetchingMembro) return <FullScreenLoader />;
    if (!session) return <Navigate to="/login" replace />;
    if (restauranteId) return <Navigate to="/" replace />;
    if (pendingInvite) return <Navigate to="/convite-pendente" replace />;

    return <Onboarding />;
};

// Rota de convite pendente: exige sessão SEM restaurante e COM convite
const InviteRoute = () => {
    const { session, isLoading, isFetchingMembro, restauranteId, pendingInvite } = useAuth();

    if (isLoading || isFetchingMembro) return <FullScreenLoader />;
    if (!session) return <Navigate to="/login" replace />;
    if (restauranteId) return <Navigate to="/" replace />;
    if (!pendingInvite) return <Navigate to="/onboarding" replace />;

    return <PendingInvite />;
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
    const { session, isLoading, isFetchingMembro, restauranteId, pendingInvite } = useAuth();

    // Só bloqueia quando realmente não sabemos pra onde mandar o user.
    // Se já temos restauranteId OU pendingInvite, um re-fetch em background
    // não deve derrubar a árvore (isso desmontaria o importador de fichas).
    if (isLoading) return <FullScreenLoader />;
    if (isFetchingMembro && !restauranteId && !pendingInvite) return <FullScreenLoader />;

    const redirectIfAuth = session
        ? (restauranteId
            ? <Navigate to="/" replace />
            : <Navigate to={pendingInvite ? '/convite-pendente' : '/onboarding'} replace />)
        : null;

    return (
        <Routes>
            {/* Rotas públicas */}
            <Route path="/login"          element={redirectIfAuth ?? <Login />} />
            <Route path="/register"       element={redirectIfAuth ?? <Register />} />
            <Route path="/reset-password" element={redirectIfAuth ?? <ResetPassword />} />
            <Route path="/update-password" element={<UpdatePassword />} />

            {/* Onboarding e convite pendente (sessão obrigatória, sem restaurante) */}
            <Route path="/onboarding"       element={<OnboardingRoute />} />
            <Route path="/convite-pendente" element={<InviteRoute />} />

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
                                path="/importar"
                                element={
                                    <RoleRoute allowed={['dono', 'gerente']}>
                                        <Suspense fallback={<FullScreenLoader />}>
                                            <ImportarFichaTecnica />
                                        </Suspense>
                                    </RoleRoute>
                                }
                            />
                            <Route path="/checklists" element={<Checklists />} />
                            <Route path="/feedbacks" element={<Feedbacks />} />
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
