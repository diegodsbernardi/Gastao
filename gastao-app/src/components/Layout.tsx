import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
    Menu, Home, ShoppingBag, LogOut, Package, Users, X,
    FileText, UtensilsCrossed, ChefHat, BarChart3, ClipboardList, MessageCircle,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';

export const Layout = ({ children }: { children: React.ReactNode }) => {
    const location = useLocation();
    const { signOut, user, nomeRestaurante, brandColor, logoUrl } = useAuth();
    const { isDonoOrGerente, canViewEquipe, canViewDashboard, canViewSales } = usePermissions();
    const [mobileOpen, setMobileOpen] = useState(false);

    const userInitial = user?.email?.[0]?.toUpperCase() ?? 'U';
    const primary = brandColor ?? '#FF6B35';

    // ── Grupos de navegação ───────────────────────────────────────────────────
    const navGroups = [
        {
            label: 'Produção',
            show: true,
            items: [
                { to: '/ingredients', Icon: Package,         label: 'Insumos',        show: isDonoOrGerente },
                { to: '/preparos',    Icon: ChefHat,         label: 'Preparos',        show: true },
                { to: '/recipes',     Icon: UtensilsCrossed, label: 'Fichas Técnicas', show: true },
            ],
        },
        {
            label: 'Operação',
            show: true,
            items: [
                { to: '/checklists', Icon: ClipboardList, label: 'Checklists', show: true },
                { to: '/feedbacks',  Icon: MessageCircle, label: 'Feedbacks',  show: true },
            ],
        },
        {
            label: 'Financeiro',
            show: canViewDashboard,
            items: [
                { to: '/', Icon: BarChart3, label: 'Dashboard', show: true },
                { to: '/sales', Icon: ShoppingBag, label: 'Vendas', show: canViewSales },
                { to: '/notas-fiscais', Icon: FileText, label: 'Notas Fiscais', show: true },
            ],
        },
        {
            label: 'Gestão',
            show: canViewEquipe,
            items: [
                { to: '/equipe', Icon: Users, label: 'Equipe', show: true },
            ],
        },
    ];

    const allNavItems = navGroups
        .filter(g => g.show)
        .flatMap(g => g.items.filter(i => i.show));
    const bottomNavItems = allNavItems.slice(0, 4);
    const hasOverflow = allNavItems.length > 4;

    const isActive = (to: string) =>
        to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

    const NavItem = ({ to, Icon, label }: { to: string; Icon: React.ElementType; label: string }) => {
        const active = isActive(to);
        return (
            <li>
                <Link
                    to={to}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2 min-h-[44px] rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${active
                        ? 'font-semibold'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                        }`}
                    style={active ? { color: primary, backgroundColor: `${primary}14` } : undefined}
                >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{label}</span>
                </Link>
            </li>
        );
    };

    const sidebarContent = (
        <div className="flex flex-col h-full">

            {/* Logo */}
            {logoUrl ? (
                <div className="px-5 py-5 border-b border-slate-100 shrink-0">
                    <img
                        src={logoUrl}
                        alt={nomeRestaurante || 'Logo'}
                        className="w-full h-auto object-contain"
                    />
                </div>
            ) : (
                <div className="h-14 flex items-center px-4 border-b border-slate-100 gap-3 shrink-0">
                    <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: primary }}
                    >
                        <UtensilsCrossed className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-sm font-bold text-slate-900 truncate">
                        {nomeRestaurante || ''}
                    </span>
                </div>
            )}

            {/* Nav agrupada */}
            <nav className="flex-1 overflow-y-auto py-3 px-2">
                {navGroups.filter(g => g.show).map(group => (
                    <div key={group.label} className="mb-4">
                        <p className="px-3 mb-1 text-xs font-bold uppercase tracking-widest text-slate-400 select-none">
                            {group.label}
                        </p>
                        <ul className="space-y-0.5">
                            {group.items.filter(i => i.show).map(item => (
                                <NavItem key={item.to} to={item.to} Icon={item.Icon} label={item.label} />
                            ))}
                        </ul>
                    </div>
                ))}
            </nav>

            {/* Rodapé: perfil + logout */}
            <div className="p-3 border-t border-slate-100 shrink-0">
                <div className="flex items-center gap-2.5 px-3 py-2 mb-1 rounded-lg">
                    <div
                        className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs text-white shrink-0"
                        style={{ backgroundColor: primary }}
                    >
                        {userInitial}
                    </div>
                    <div className="min-w-0">
                        <p className="text-xs text-slate-500 truncate leading-tight">{user?.email}</p>
                    </div>
                </div>
                <button
                    onClick={signOut}
                    className="flex items-center w-full gap-3 px-3 py-2 min-h-[44px] text-sm text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1"
                >
                    <LogOut className="w-4 h-4 shrink-0" />
                    <span>Sair</span>
                </button>
            </div>
        </div>
    );

    return (
        // CSS custom property injetada aqui — toda a app herda via var(--color-primary)
        <div
            className="flex h-dvh bg-slate-50"
            style={{ '--color-primary': primary } as React.CSSProperties}
        >
            {/* Sidebar desktop */}
            <aside className="w-56 bg-white border-r border-slate-100 hidden md:flex flex-col shrink-0">
                {sidebarContent}
            </aside>

            {/* Overlay mobile */}
            {mobileOpen && (
                <div
                    className="fixed inset-0 z-40 bg-black/40 md:hidden"
                    onClick={() => setMobileOpen(false)}
                />
            )}

            {/* Drawer mobile */}
            <aside
                className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-100 flex flex-col md:hidden transition-transform duration-300 ease-in-out ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
            >
                <button
                    onClick={() => setMobileOpen(false)}
                    aria-label="Fechar menu"
                    className="absolute top-3.5 right-3 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                    <X className="w-4 h-4" />
                </button>
                {sidebarContent}
            </aside>

            {/* Área principal */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <header className="h-14 bg-white border-b border-slate-100 flex items-center px-4 md:px-6 justify-between shrink-0">
                    <button
                        onClick={() => setMobileOpen(true)}
                        className="md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                        aria-label="Abrir menu"
                    >
                        <Menu className="w-5 h-5" />
                    </button>
                    <div className="ml-auto">
                        <div
                            className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm text-white"
                            style={{ backgroundColor: primary }}
                        >
                            {userInitial}
                        </div>
                    </div>
                </header>

                <main className="flex-1 overflow-y-auto p-4 pb-20 md:p-6 md:pb-6 lg:p-8">
                    {children}
                </main>
            </div>

            {/* Bottom navigation (mobile only) */}
            <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-100 flex md:hidden shadow-[0_-1px_3px_rgba(0,0,0,0.08)]">
                {bottomNavItems.map(({ to, Icon, label }) => {
                    const active = isActive(to);
                    return (
                        <Link
                            key={to}
                            to={to}
                            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
                            style={active ? { color: primary } : undefined}
                        >
                            <Icon className={`w-5 h-5 ${active ? '' : 'text-slate-500'}`} />
                            <span className={`text-xs font-medium leading-none ${active ? '' : 'text-slate-500'}`}>
                                {label}
                            </span>
                        </Link>
                    );
                })}
                {hasOverflow && (
                    <button
                        onClick={() => setMobileOpen(true)}
                        aria-label="Ver mais opções"
                        className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
                    >
                        <Menu className="w-5 h-5" />
                        <span className="text-xs font-medium leading-none">Mais</span>
                    </button>
                )}
            </nav>
        </div>
    );
};
