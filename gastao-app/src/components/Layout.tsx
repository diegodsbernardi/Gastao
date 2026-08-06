import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import {
    Menu, Home, ShoppingBag, LogOut, Package, Users, X,
    FileText, UtensilsCrossed, ChefHat, BarChart3, ClipboardList, MessageCircle, FileSpreadsheet,
    Check, ChevronDown, Loader2, Plus, Store, Bike } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';

export const Layout = ({ children }: { children: React.ReactNode }) => {
    const location = useLocation();
    const { signOut, user, nomeRestaurante, brandColor, logoUrl, memberships, switchRestaurante, perfil } = useAuth();
    const { isDonoOrGerente, canViewEquipe, canViewDashboard, canViewSales } = usePermissions();
    const [mobileOpen, setMobileOpen] = useState(false);

    const userInitial = user?.email?.[0]?.toUpperCase() ?? 'U';
    const primary = brandColor ?? '#FF6B35';

    // ── Grupos de navegação ───────────────────────────────────────────────────
    const navGroups = [
        {
            label: 'Financeiro',
            show: canViewDashboard,
            items: [
                { to: '/',              Icon: BarChart3,   label: 'Dashboard',    show: true },
                { to: '/sales',         Icon: ShoppingBag, label: 'Vendas',       show: canViewSales },
                { to: '/notas-fiscais', Icon: FileText,    label: 'Notas Fiscais', show: true },
                { to: '/ifood',         Icon: Bike,        label: 'iFood',        show: isDonoOrGerente },
            ],
        },
        {
            label: 'Produção',
            show: true,
            items: [
                { to: '/ingredients', Icon: Package,         label: 'Insumos',         show: isDonoOrGerente },
                { to: '/preparos',    Icon: ChefHat,         label: 'Preparos',        show: true },
                { to: '/recipes',     Icon: UtensilsCrossed, label: 'Fichas Técnicas', show: true },
                { to: '/importar',    Icon: FileSpreadsheet, label: 'Importar Planilha', show: isDonoOrGerente },
            ],
        },
        {
            label: 'Operação',
            show: true,
            items: [
                { to: '/checklists', Icon: ClipboardList, label: 'Checklists', show: true },
            ],
        },
        {
            label: 'Gestão',
            show: true,
            items: [
                { to: '/feedbacks', Icon: MessageCircle, label: 'Feedbacks', show: true },
                { to: '/equipe',    Icon: Users,         label: 'Equipe',    show: canViewEquipe },
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
                        <p className="px-3 mb-1 text-xs font-bold uppercase tracking-widest text-slate-500 select-none">
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
                    <div className="ml-auto flex items-center gap-3">
                        {(memberships.length > 1 || perfil === 'bpo') && (
                            <RestauranteSwitcher
                                memberships={memberships}
                                onSwitch={switchRestaurante}
                                isBpo={perfil === 'bpo'}
                            />
                        )}
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

// ── Seletor de restaurante (multi-tenant / BPO) ─────────────────────────────

import { supabase } from '../lib/supabase';
import type { Membership } from '../contexts/AuthContext';

function RestauranteSwitcher({
    memberships, onSwitch, isBpo,
}: {
    memberships: Membership[];
    onSwitch: (id: string) => Promise<void>;
    isBpo: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [switching, setSwitching] = useState<string | null>(null);
    const [showNovo, setShowNovo] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    const ativo = memberships.find(m => m.eh_ativo) ?? null;

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const handleSwitch = async (id: string) => {
        if (id === ativo?.restaurante_id) { setOpen(false); return; }
        setSwitching(id);
        try {
            await onSwitch(id); // faz reload completo — não volta daqui
        } catch (err) {
            toast.error(String(err));
            setSwitching(null);
        }
    };

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen(v => !v)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors max-w-[220px]"
            >
                <Store className="w-4 h-4 text-slate-500 shrink-0" />
                <span className="truncate">{ativo?.restaurante_nome ?? 'Restaurante'}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            </button>

            {open && (
                <div className="absolute right-0 mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-50">
                    <ul className="max-h-72 overflow-y-auto py-1">
                        {memberships.map(m => (
                            <li key={m.restaurante_id}>
                                <button
                                    onClick={() => handleSwitch(m.restaurante_id)}
                                    disabled={switching !== null}
                                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left hover:bg-slate-50 transition-colors disabled:opacity-60"
                                >
                                    <span
                                        className="w-2.5 h-2.5 rounded-full shrink-0"
                                        style={{ backgroundColor: m.brand_color ?? '#FF6B35' }}
                                    />
                                    <span className="flex-1 truncate font-medium text-slate-700">{m.restaurante_nome}</span>
                                    {switching === m.restaurante_id
                                        ? <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
                                        : m.eh_ativo && <Check className="w-4 h-4 text-primary-600" />}
                                </button>
                            </li>
                        ))}
                    </ul>
                    {isBpo && (
                        <button
                            onClick={() => { setOpen(false); setShowNovo(true); }}
                            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-primary-700 border-t border-slate-100 hover:bg-primary-50 transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                            Novo restaurante
                        </button>
                    )}
                </div>
            )}

            {showNovo && <ModalNovoRestaurante onClose={() => setShowNovo(false)} />}
        </div>
    );
}

function ModalNovoRestaurante({ onClose }: { onClose: () => void }) {
    const [nome, setNome] = useState('');
    const [cnpj, setCnpj] = useState('');
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!nome.trim()) return;
        setSaving(true);
        try {
            const { error } = await supabase.rpc('criar_restaurante_bpo', {
                p_nome: nome.trim(),
                p_cnpj: cnpj.trim() || null,
            });
            if (error) throw new Error(error.message);
            // Restaurante criado + switch feito no servidor → onboarding assistido
            window.location.assign('/importar');
        } catch (err) {
            toast.error(String(err));
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
                <h2 className="text-lg font-bold text-slate-800">Novo restaurante</h2>
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Nome *</label>
                    <input
                        autoFocus
                        value={nome}
                        onChange={e => setNome(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
                        placeholder="Ex.: Cantina da Nona"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">CNPJ (opcional)</label>
                    <input
                        value={cnpj}
                        onChange={e => setCnpj(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
                        placeholder="00.000.000/0000-00"
                    />
                </div>
                <p className="text-xs text-slate-500">
                    Depois de criar, você cai direto na importação da planilha-mãe do cliente.
                </p>
                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        type="submit"
                        disabled={saving || !nome.trim()}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-60 transition-colors"
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Criar restaurante
                    </button>
                </div>
            </form>
        </div>
    );
}
