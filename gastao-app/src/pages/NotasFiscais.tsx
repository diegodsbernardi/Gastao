import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
    AlertCircle, Check, ChevronDown, CheckCircle2, FileText, Files,
    DollarSign, Loader2, Plus, RefreshCw, Search, Trash2, Upload, X, XCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
    confirmarItem, confirmarNfe, criarInsumoDeNfe, deletarNota, getDriveSyncStatus,
    ignorarItem, NotaFiscal, NfeItem, solicitarSyncNfe, uploadNfeXml, DriveSyncStatus,
} from '../lib/nfe';
import { AtualizarCustosNfe } from './AtualizarCustosNfe';
import { DecimalInput } from '../components/DecimalInput';
import { useConfirm } from '../components/ConfirmDialog';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';

// ── Types ─────────────────────────────────────────────────────────────────

interface Ingredient { id: string; name: string; unit_type: string; tipo: string; }

interface NfeItemComNome extends NfeItem {
    insumo_sugerido_nome?: string;
    insumo_confirmado_nome?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtCurrency(v: number | null) {
    if (v == null) return '—';
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(s: string | null) {
    if (!s) return '—';
    return new Date(s).toLocaleDateString('pt-BR');
}

function fmtNum(v: number | null) {
    if (v == null) return '—';
    return v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

// Mostra a unidade tributável só quando ela difere da comercial (ex: CX → KG).
// É o que revela o peso/preço reais por trás da embalagem de compra.
function temConversao(item: NfeItem) {
    return (
        !!item.unidade_tributavel &&
        item.unidade_tributavel !== item.unidade &&
        item.quantidade_tributavel != null
    );
}

function fmtFileSize(bytes: number) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── Badge de status da nota ────────────────────────────────────────────────

function StatusBadgeNota({ status }: { status: NotaFiscal['status'] }) {
    const map = {
        pendente:  'bg-yellow-100 text-yellow-700',
        confirmada:'bg-green-100 text-green-700',
        cancelada: 'bg-slate-100 text-slate-500',
    };
    const labels = { pendente: 'Pendente', confirmada: 'Confirmada', cancelada: 'Cancelada' };
    return (
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${map[status]}`}>
            {labels[status]}
        </span>
    );
}

// ── Badge de confiança da IA ───────────────────────────────────────────────

export function ConfidenceBadge({ v }: { v: number | null }) {
    if (v == null) return null;
    const pct = Math.round(v * 100);
    const color = v >= 0.8 ? 'bg-green-100 text-green-700'
                : v >= 0.5 ? 'bg-yellow-100 text-yellow-700'
                :             'bg-red-100 text-red-600';
    return (
        <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${color}`}>
            {pct}%
        </span>
    );
}

// ── Badge de status do item ────────────────────────────────────────────────

function StatusBadgeItem({ status }: { status: NfeItem['status'] }) {
    const map = {
        pendente:    'bg-slate-100 text-slate-500',
        vinculado:   'bg-green-100 text-green-700',
        ignorado:    'bg-slate-100 text-slate-500',
        novo_insumo: 'bg-primary-100 text-primary-700',
    };
    const labels = { pendente: 'Pendente', vinculado: 'Vinculado', ignorado: 'Ignorado', novo_insumo: 'Novo insumo' };
    return (
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${map[status]}`}>
            {labels[status]}
        </span>
    );
}

// ── Dropdown de insumos com busca ──────────────────────────────────────────

function InsumoDropdown({
    ingredients, onSelect, onClose,
}: {
    ingredients: Ingredient[];
    onSelect: (id: string, name: string) => void;
    onClose: () => void;
}) {
    const [q, setQ] = useState('');
    const filtered = ingredients.filter(i =>
        i.name.toLowerCase().includes(q.toLowerCase())
    );
    const ref = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    // Posição fixa calculada a partir do botão-âncora (pai imediato, o div
    // "relative"). Escapa de qualquer overflow da tabela; abre pra cima
    // quando falta espaço abaixo na viewport.
    const [pos, setPos] = useState<React.CSSProperties>({ visibility: 'hidden' });

    const updatePos = useCallback(() => {
        const anchor = ref.current?.parentElement;
        if (!anchor) return;
        const r = anchor.getBoundingClientRect();
        const width = 256; // w-64
        const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
        const openUp = window.innerHeight - r.bottom < 300 && r.top >= 300;
        setPos(openUp
            ? { left, bottom: window.innerHeight - r.top + 4 }
            : { left, top: r.bottom + 4 });
    }, []);

    useLayoutEffect(() => { updatePos(); }, [updatePos]);

    // Foco sem scroll, só depois de posicionado (elemento hidden não é focável).
    // autoFocus nativo scrollaria o container pra revelar o input.
    const focou = useRef(false);
    useEffect(() => {
        if (!focou.current && pos.visibility !== 'hidden' && inputRef.current) {
            focou.current = true;
            inputRef.current.focus({ preventScroll: true });
        }
    }, [pos]);

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener('mousedown', handleClick);
        // Com position fixed, scroll/resize descolam o dropdown do botão —
        // reposiciona pra ele acompanhar a âncora.
        window.addEventListener('scroll', updatePos, true);
        window.addEventListener('resize', updatePos);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            window.removeEventListener('scroll', updatePos, true);
            window.removeEventListener('resize', updatePos);
        };
    }, [onClose, updatePos]);

    return (
        <div
            ref={ref}
            style={pos}
            className="fixed z-50 w-64 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden"
        >
            <div className="p-2 border-b border-slate-100">
                <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 rounded-lg">
                    <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <input
                        ref={inputRef}
                        className="flex-1 bg-transparent text-sm outline-none placeholder-slate-400"
                        placeholder="Buscar insumo…"
                        value={q}
                        onChange={e => setQ(e.target.value)}
                    />
                </div>
            </div>
            <ul className="max-h-48 overflow-y-auto">
                {filtered.length === 0 && (
                    <li className="px-3 py-2 text-sm text-slate-500">Nenhum resultado</li>
                )}
                {filtered.map(ing => (
                    <li key={ing.id}>
                        <button
                            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 transition-colors"
                            onClick={() => { onSelect(ing.id, ing.name); onClose(); }}
                        >
                            <span className="font-medium text-slate-700">{ing.name}</span>
                            <span className="text-slate-500 ml-1">({ing.unit_type})</span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

// ── Modal: criar insumo a partir de item da NF-e ───────────────────────────

function ModalCriarInsumo({
    item, onClose, onCreated,
}: {
    item: NfeItemComNome;
    onClose: () => void;
    onCreated: () => void;
}) {
    const { restauranteId } = useAuth();
    const [name, setName] = useState(item.descricao_xml);
    const [unitType, setUnitType] = useState(item.unidade.toLowerCase());
    const [tipo, setTipo] = useState('insumo_base');
    const [avgCost, setAvgCost] = useState<number | ''>(item.valor_unitario);
    const [stockQty, setStockQty] = useState<number | ''>(item.quantidade);
    const [saving, setSaving] = useState(false);

    // Categoria (ex.: "Bebidas") — mesmas opções da tela de Insumos, por tipo.
    const PREDEFINED_BASE = ['Hortifruti', 'Proteínas', 'Queijos'];
    const NOVA = '__nova__';
    const [customCats, setCustomCats] = useState<{ name: string; ingredient_tipo: string }[]>([]);
    const [categoria, setCategoria] = useState('');
    const [novaCategoria, setNovaCategoria] = useState('');

    useEffect(() => {
        supabase.from('ingredient_categories').select('name, ingredient_tipo').order('name')
            .then(({ data }) => setCustomCats(data ?? []));
    }, []);

    const categoriasDoTipo = [
        ...(tipo === 'insumo_base' ? PREDEFINED_BASE : []),
        ...customCats.filter(c => c.ingredient_tipo === tipo).map(c => c.name),
    ].filter((v, i, a) => a.indexOf(v) === i);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        setSaving(true);
        try {
            let categoriaFinal: string | null = categoria || null;
            if (categoria === NOVA) {
                categoriaFinal = novaCategoria.trim() || null;
                // Registra a categoria nova pro dropdown das próximas vezes
                if (categoriaFinal && !categoriasDoTipo.includes(categoriaFinal)) {
                    await supabase.from('ingredient_categories').insert({
                        restaurant_id: restauranteId,
                        name: categoriaFinal,
                        ingredient_tipo: tipo,
                    });
                }
            }
            await criarInsumoDeNfe(item.id, {
                name: name.trim(),
                unit_type: unitType.toLowerCase(),
                tipo,
                categoria: tipo !== 'embalagem' ? categoriaFinal : null,
                avg_cost_per_unit: avgCost || item.valor_unitario,
                stock_quantity: stockQty || 0,
            });
            toast.success('Insumo criado e vinculado com sucesso!');
            onCreated();
        } catch (err) {
            toast.error(String(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
                <div className="flex items-center justify-between p-5 border-b border-slate-100">
                    <h2 className="text-base font-semibold text-slate-800">Criar novo insumo</h2>
                    <button onClick={onClose} className="p-2 text-slate-500 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Nome do insumo</label>
                        <input
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            required
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Unidade</label>
                            <input
                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                                value={unitType}
                                onChange={e => setUnitType(e.target.value.toLowerCase())}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Tipo</label>
                            <select
                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                                value={tipo}
                                onChange={e => { setTipo(e.target.value); setCategoria(''); setNovaCategoria(''); }}
                            >
                                <option value="insumo_base">Insumo Base</option>
                                <option value="insumo_direto">Item Pronto</option>
                                <option value="embalagem">Embalagem</option>
                            </select>
                        </div>
                    </div>
                    {tipo !== 'embalagem' && (
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Categoria</label>
                            <select
                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                                value={categoria}
                                onChange={e => setCategoria(e.target.value)}
                            >
                                <option value="">Sem categoria</option>
                                {categoriasDoTipo.map(c => <option key={c} value={c}>{c}</option>)}
                                <option value={NOVA}>+ Nova categoria…</option>
                            </select>
                            {categoria === NOVA && (
                                <input
                                    autoFocus
                                    className="mt-2 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                                    placeholder='Ex.: Bebidas'
                                    value={novaCategoria}
                                    onChange={e => setNovaCategoria(e.target.value)}
                                />
                            )}
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Custo unitário (R$)</label>
                            <DecimalInput
                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                                value={avgCost}
                                onChange={setAvgCost}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Qtd inicial</label>
                            <DecimalInput
                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                                value={stockQty}
                                onChange={setStockQty}
                            />
                        </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                        >
                            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                            Criar e vincular
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// ── Linha de item na tabela ────────────────────────────────────────────────

function ItemRow({
    item, ingredients, readOnly, onUpdated,
}: {
    item: NfeItemComNome;
    ingredients: Ingredient[];
    readOnly: boolean;
    onUpdated: () => void;
}) {
    const [showDropdown, setShowDropdown] = useState(false);
    const [showCriarModal, setShowCriarModal] = useState(false);
    const [loadingAction, setLoadingAction] = useState<'confirmar' | 'ignorar' | null>(null);

    const handleConfirmar = async () => {
        const insumoId = item.insumo_sugerido_id;
        if (!insumoId) return;
        setLoadingAction('confirmar');
        try {
            await confirmarItem(item.id, insumoId);
            onUpdated();
        } catch (err) {
            toast.error(String(err));
        } finally {
            setLoadingAction(null);
        }
    };

    const handleConfirmarManual = async (insumoId: string) => {
        setLoadingAction('confirmar');
        try {
            await confirmarItem(item.id, insumoId);
            onUpdated();
        } catch (err) {
            toast.error(String(err));
        } finally {
            setLoadingAction(null);
        }
    };

    const handleIgnorar = async () => {
        setLoadingAction('ignorar');
        try {
            await ignorarItem(item.id);
            onUpdated();
        } catch (err) {
            toast.error(String(err));
        } finally {
            setLoadingAction(null);
        }
    };

    const isProcessing = loadingAction !== null;

    // ── Mobile card ──
    return (
        <>
            {/* Desktop row */}
            <tr className="border-b border-slate-100 hover:bg-slate-50 transition-colors hidden md:table-row">
                <td className="px-4 py-3 text-sm font-medium text-slate-700">
                    <div>{item.descricao_xml}</div>
                    {item.codigo_produto && <div className="text-xs text-slate-500">{item.codigo_produto}</div>}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                    <div>{item.quantidade} {item.unidade}</div>
                    {temConversao(item) && (
                        <div className="text-xs font-medium text-emerald-600">
                            = {fmtNum(item.quantidade_tributavel)} {item.unidade_tributavel}
                        </div>
                    )}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                    <div>{fmtCurrency(item.valor_unitario)}</div>
                    {temConversao(item) && (
                        <div className="text-xs font-medium text-emerald-600">
                            {fmtCurrency(item.valor_unitario_tributavel)}/{item.unidade_tributavel}
                        </div>
                    )}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                    {fmtCurrency(item.valor_total)}
                </td>
                <td className="px-4 py-3 text-sm">
                    {item.insumo_sugerido_id && item.status === 'pendente' ? (
                        <div className="flex items-center gap-1.5">
                            <span className="text-slate-700">{item.insumo_sugerido_nome ?? '—'}</span>
                            <ConfidenceBadge v={item.confianca_match} />
                        </div>
                    ) : item.insumo_confirmado_id ? (
                        <span className="text-slate-700">{item.insumo_confirmado_nome ?? '—'}</span>
                    ) : (
                        <span className="text-slate-500 text-xs">Nenhum encontrado</span>
                    )}
                </td>
                <td className="px-4 py-3">
                    <StatusBadgeItem status={item.status} />
                </td>
                <td className="px-4 py-3">
                    {!readOnly && item.status === 'pendente' && (
                        <div className="flex items-center gap-1.5">
                            {item.insumo_sugerido_id && (
                                <button
                                    onClick={handleConfirmar}
                                    disabled={isProcessing}
                                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                                >
                                    {loadingAction === 'confirmar'
                                        ? <Loader2 className="w-3 h-3 animate-spin" />
                                        : <Check className="w-3 h-3" />}
                                    Confirmar
                                </button>
                            )}
                            <div className="relative">
                                <button
                                    onClick={() => setShowDropdown(v => !v)}
                                    disabled={isProcessing}
                                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 disabled:opacity-50 transition-colors"
                                >
                                    {item.insumo_sugerido_id ? 'Alterar' : 'Vincular'}
                                    <ChevronDown className="w-3 h-3" />
                                </button>
                                {showDropdown && (
                                    <InsumoDropdown
                                        ingredients={ingredients}
                                        onSelect={handleConfirmarManual}
                                        onClose={() => setShowDropdown(false)}
                                    />
                                )}
                            </div>
                            <button
                                onClick={() => setShowCriarModal(true)}
                                disabled={isProcessing}
                                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-primary-600 border border-primary-200 rounded-lg hover:bg-primary-50 disabled:opacity-50 transition-colors"
                            >
                                <Plus className="w-3 h-3" />
                                Criar
                            </button>
                            <button
                                onClick={handleIgnorar}
                                disabled={isProcessing}
                                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-100 disabled:opacity-50 transition-colors"
                            >
                                {loadingAction === 'ignorar'
                                    ? <Loader2 className="w-3 h-3 animate-spin" />
                                    : <X className="w-3 h-3" />}
                                Ignorar
                            </button>
                        </div>
                    )}
                    {!readOnly && item.status !== 'pendente' && (
                        <span className="text-xs text-slate-500">—</span>
                    )}
                </td>
            </tr>

            {/* Mobile card */}
            <div className="md:hidden bg-white border border-slate-200 rounded-xl p-4 space-y-3 mb-2">
                <div className="flex items-start justify-between gap-2">
                    <div>
                        <p className="text-sm font-medium text-slate-800">{item.descricao_xml}</p>
                        {item.codigo_produto && <p className="text-xs text-slate-500">{item.codigo_produto}</p>}
                    </div>
                    <StatusBadgeItem status={item.status} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-slate-500">
                    <div><span className="font-medium">Qtd:</span> {item.quantidade} {item.unidade}</div>
                    <div><span className="font-medium">Unit:</span> {fmtCurrency(item.valor_unitario)}</div>
                    <div><span className="font-medium">Total:</span> {fmtCurrency(item.valor_total)}</div>
                </div>
                {temConversao(item) && (
                    <div className="text-xs font-medium text-emerald-600">
                        = {fmtNum(item.quantidade_tributavel)} {item.unidade_tributavel} · {fmtCurrency(item.valor_unitario_tributavel)}/{item.unidade_tributavel}
                    </div>
                )}
                {item.insumo_sugerido_id && item.status === 'pendente' && (
                    <div className="flex items-center gap-2 text-xs">
                        <span className="text-slate-500">Sugestão:</span>
                        <span className="font-medium text-slate-700">{item.insumo_sugerido_nome}</span>
                        <ConfidenceBadge v={item.confianca_match} />
                    </div>
                )}
                {item.insumo_confirmado_id && (
                    <div className="flex items-center gap-2 text-xs">
                        <span className="text-slate-500">Insumo:</span>
                        <span className="font-medium text-slate-700">{item.insumo_confirmado_nome}</span>
                    </div>
                )}
                {!readOnly && item.status === 'pendente' && (
                    <div className="flex flex-wrap gap-2 pt-1">
                        {item.insumo_sugerido_id && (
                            <button
                                onClick={handleConfirmar}
                                disabled={isProcessing}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
                            >
                                {loadingAction === 'confirmar' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                Confirmar
                            </button>
                        )}
                        <div className="relative">
                            <button
                                onClick={() => setShowDropdown(v => !v)}
                                disabled={isProcessing}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 disabled:opacity-50"
                            >
                                {item.insumo_sugerido_id ? 'Alterar' : 'Vincular'}
                                <ChevronDown className="w-3 h-3" />
                            </button>
                            {showDropdown && (
                                <InsumoDropdown
                                    ingredients={ingredients}
                                    onSelect={handleConfirmarManual}
                                    onClose={() => setShowDropdown(false)}
                                />
                            )}
                        </div>
                        <button
                            onClick={() => setShowCriarModal(true)}
                            disabled={isProcessing}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary-600 border border-primary-200 rounded-lg hover:bg-primary-50 disabled:opacity-50"
                        >
                            <Plus className="w-3 h-3" />
                            Criar insumo
                        </button>
                        <button
                            onClick={handleIgnorar}
                            disabled={isProcessing}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-100 disabled:opacity-50"
                        >
                            {loadingAction === 'ignorar' ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                            Ignorar
                        </button>
                    </div>
                )}
            </div>

            {showCriarModal && (
                <ModalCriarInsumo
                    item={item}
                    onClose={() => setShowCriarModal(false)}
                    onCreated={() => { setShowCriarModal(false); onUpdated(); }}
                />
            )}
        </>
    );
}

// ── View: Upload ───────────────────────────────────────────────────────────

function UploadView({ onUploaded }: { onUploaded: (notaId: string) => void }) {
    const [file, setFile] = useState<File | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadStep, setUploadStep] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const handleFile = (f: File) => {
        if (!f.name.endsWith('.xml')) {
            toast.error('Selecione um arquivo .xml');
            return;
        }
        if (f.size > 5 * 1024 * 1024) {
            toast.error('Arquivo deve ter menos de 5 MB');
            return;
        }
        setFile(f);
    };

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) handleFile(f);
    }, []);

    const handleProcess = async () => {
        if (!file) return;
        setUploading(true);
        setUploadStep('Fazendo upload do arquivo…');
        try {
            // pequeno delay para mostrar o step ao usuário
            await new Promise(r => setTimeout(r, 300));
            setUploadStep('Processando nota fiscal…');
            await new Promise(r => setTimeout(r, 200));
            setUploadStep('Sugerindo vinculações com IA…');
            const notaId = await uploadNfeXml(file);
            toast.success('Nota fiscal processada com sucesso!');
            onUploaded(notaId);
        } catch (err) {
            toast.error(String(err));
        } finally {
            setUploading(false);
            setUploadStep('');
        }
    };

    return (
        <div className="max-w-xl mx-auto">
            <h2 className="text-lg font-semibold text-slate-800 mb-6">Importar NF-e</h2>

            {/* Drop zone */}
            <div
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                className={`
                    border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors
                    ${isDragging ? 'border-primary-500 bg-primary-50' : 'border-slate-300 hover:border-slate-400 bg-white'}
                `}
            >
                <input
                    ref={inputRef}
                    type="file"
                    accept=".xml"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
                <Upload className={`w-10 h-10 mx-auto mb-3 ${isDragging ? 'text-primary-500' : 'text-slate-500'}`} />
                {file ? (
                    <div>
                        <p className="font-medium text-slate-700">{file.name}</p>
                        <p className="text-sm text-slate-500 mt-0.5">{fmtFileSize(file.size)}</p>
                    </div>
                ) : (
                    <div>
                        <p className="text-slate-600 font-medium">Arraste o XML da nota fiscal</p>
                        <p className="text-sm text-slate-500 mt-1">ou clique para selecionar</p>
                        <p className="text-xs text-slate-500 mt-3">Apenas arquivos .xml até 5 MB</p>
                    </div>
                )}
            </div>

            {file && !uploading && (
                <button
                    onClick={handleProcess}
                    className="mt-4 w-full py-2.5 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 transition-colors"
                >
                    Processar nota fiscal
                </button>
            )}

            {uploading && (
                <div className="mt-4 flex items-center justify-center gap-3 py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-primary-600" />
                    <span className="text-sm text-slate-600">{uploadStep}</span>
                </div>
            )}
        </div>
    );
}

// ── View: Upload em lote (BPO) ─────────────────────────────────────────────
//
// Aceita N XMLs ao mesmo tempo e processa em loop sequencial (não paralelo —
// evita rate limit nas edge functions parse-nfe e match-nfe-items).
// Faz dedup soft client-side antes do upload via parse leve do XML
// (extrai numero + cnpj + data). Notas já existentes no banco viram "duplicada"
// sem reprocessar (poupa storage + edge function calls).
// =============================================================================

type BulkStatus = 'pending' | 'processing' | 'success' | 'duplicate' | 'error';

interface BulkResult {
    fileName: string;
    status: BulkStatus;
    notaId?: string;
    valor?: number;
    motivo?: string;
    error?: string;
}

/** Parse leve do XML pra extrair só os 3 campos necessários pro dedup. */
function parseLightNFe(xmlText: string): { numero: string; cnpj: string; dataEmi: string } | null {
    try {
        const stripped = xmlText
            .replace(/\s+xmlns(?::[a-zA-Z0-9_-]+)?="[^"]*"/g, '')
            .replace(/<([/]?)([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+)/g, '<$1$3');
        const dom = new DOMParser().parseFromString(stripped, 'text/xml');
        const numero = dom.querySelector('ide > nNF')?.textContent?.trim() ?? '';
        const cnpj = dom.querySelector('emit > CNPJ')?.textContent?.trim() ?? '';
        const dataRaw = dom.querySelector('ide > dhEmi')?.textContent?.trim()
            ?? dom.querySelector('ide > dEmi')?.textContent?.trim() ?? '';
        if (!numero || !cnpj) return null;
        return { numero, cnpj, dataEmi: dataRaw.slice(0, 10) };
    } catch {
        return null;
    }
}

function BulkUploadView({ onDone, onOpenNota }: { onDone: () => void; onOpenNota: (id: string) => void }) {
    const [files, setFiles] = useState<File[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [phase, setPhase] = useState<'idle' | 'processing' | 'done'>('idle');
    const [results, setResults] = useState<BulkResult[]>([]);
    const [currentIdx, setCurrentIdx] = useState<number | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const addFiles = (newFiles: FileList | File[]) => {
        const xmls = Array.from(newFiles).filter(f => f.name.toLowerCase().endsWith('.xml'));
        if (xmls.length === 0) {
            toast.error('Nenhum arquivo .xml selecionado');
            return;
        }
        // dedup por nome
        setFiles(prev => {
            const seen = new Set(prev.map(f => f.name));
            const novos = xmls.filter(f => !seen.has(f.name));
            return [...prev, ...novos];
        });
    };

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    }, []);

    const removeFile = (idx: number) => {
        setFiles(prev => prev.filter((_, i) => i !== idx));
    };

    const handleStart = async () => {
        if (files.length === 0) return;
        setPhase('processing');
        const initialResults: BulkResult[] = files.map(f => ({ fileName: f.name, status: 'pending' }));
        setResults(initialResults);

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            setCurrentIdx(i);
            setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'processing' } : r));

            try {
                // 1. Parse leve pra dedup
                const text = await file.text();
                const light = parseLightNFe(text);

                if (light) {
                    const cnpjDigits = light.cnpj.replace(/\D/g, '');
                    // .limit(1) em vez de .maybeSingle(): com 2+ notas casando o
                    // filtro, maybeSingle retorna erro e a nota duplicaria mesmo assim.
                    const { data: existingRows } = await supabase
                        .from('notas_fiscais')
                        .select('id, numero_nota, fornecedor_cnpj')
                        .eq('numero_nota', light.numero)
                        .ilike('fornecedor_cnpj', `%${cnpjDigits.slice(0, 8)}%`)
                        .limit(1);
                    const existing = existingRows?.[0];
                    if (existing?.id) {
                        setResults(prev => prev.map((r, idx) => idx === i ? {
                            ...r,
                            status: 'duplicate',
                            motivo: `NF ${light.numero} já existe`,
                            notaId: existing.id as string,
                        } : r));
                        continue;
                    }
                }

                // 2. Upload + parse + match completo
                const notaId = await uploadNfeXml(file);

                // 3. Pega valor pra exibir
                const { data: nota } = await supabase
                    .from('notas_fiscais')
                    .select('valor_total')
                    .eq('id', notaId)
                    .single();

                setResults(prev => prev.map((r, idx) => idx === i ? {
                    ...r,
                    status: 'success',
                    notaId,
                    valor: (nota?.valor_total as number | undefined) ?? undefined,
                } : r));
            } catch (err) {
                setResults(prev => prev.map((r, idx) => idx === i ? {
                    ...r,
                    status: 'error',
                    error: String(err).slice(0, 200),
                } : r));
            }
        }

        setCurrentIdx(null);
        setPhase('done');
    };

    const summary = {
        total: results.length,
        success: results.filter(r => r.status === 'success').length,
        duplicate: results.filter(r => r.status === 'duplicate').length,
        error: results.filter(r => r.status === 'error').length,
    };

    const totalFatur = results
        .filter(r => r.status === 'success' && r.valor)
        .reduce((s, r) => s + (r.valor ?? 0), 0);

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Upload em lote — NF-e</h2>
                    <p className="text-sm text-slate-500 mt-0.5">
                        Sobe vários XMLs de uma vez. Notas duplicadas (mesmo número + CNPJ) são puladas automaticamente.
                    </p>
                </div>
                <button
                    onClick={onDone}
                    className="px-3 py-1.5 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                    Voltar
                </button>
            </div>

            {phase === 'idle' && (
                <>
                    {/* Drop zone */}
                    <div
                        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                        onClick={() => inputRef.current?.click()}
                        className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors ${
                            isDragging ? 'border-primary-500 bg-primary-50' : 'border-slate-300 hover:border-slate-400 bg-white'
                        }`}
                    >
                        <input
                            ref={inputRef}
                            type="file"
                            accept=".xml"
                            multiple
                            className="hidden"
                            onChange={e => { if (e.target.files) addFiles(e.target.files); }}
                        />
                        <Files className={`w-10 h-10 mx-auto mb-3 ${isDragging ? 'text-primary-500' : 'text-slate-500'}`} />
                        <p className="text-slate-600 font-medium">Arraste vários XMLs aqui</p>
                        <p className="text-sm text-slate-500 mt-1">ou clique pra selecionar (segura Ctrl/Cmd ou Shift)</p>
                        {files.length > 0 && (
                            <p className="mt-3 text-sm font-medium text-primary-700">
                                {files.length} arquivo{files.length !== 1 ? 's' : ''} selecionado{files.length !== 1 ? 's' : ''}
                            </p>
                        )}
                    </div>

                    {/* Lista de selecionados */}
                    {files.length > 0 && (
                        <div className="bg-white rounded-xl border border-slate-200 p-4 max-h-72 overflow-y-auto">
                            <ul className="divide-y divide-slate-100">
                                {files.map((f, i) => (
                                    <li key={i} className="flex items-center justify-between py-1.5 text-sm">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <FileText className="w-4 h-4 text-slate-500 flex-shrink-0" />
                                            <span className="truncate text-slate-700">{f.name}</span>
                                            <span className="text-xs text-slate-500 flex-shrink-0">{fmtFileSize(f.size)}</span>
                                        </div>
                                        <button
                                            onClick={e => { e.stopPropagation(); removeFile(i); }}
                                            className="text-slate-500 hover:text-red-500 p-1"
                                            title="Remover"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {files.length > 0 && (
                        <button
                            onClick={handleStart}
                            className="w-full py-3 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 transition-colors flex items-center justify-center gap-2"
                        >
                            <Upload className="w-4 h-4" />
                            Processar {files.length} nota{files.length !== 1 ? 's' : ''}
                        </button>
                    )}
                </>
            )}

            {(phase === 'processing' || phase === 'done') && (
                <>
                    {/* Progress header */}
                    <div className="bg-white rounded-2xl border border-slate-200 p-5">
                        <div className="flex items-center justify-between mb-3">
                            <div className="text-sm font-semibold text-slate-700">
                                {phase === 'processing'
                                    ? `Processando ${(currentIdx ?? 0) + 1} de ${files.length}…`
                                    : '🎉 Concluído'}
                            </div>
                            <div className="text-xs font-mono text-slate-500">
                                {summary.success} ok · {summary.duplicate} dup · {summary.error} erro
                            </div>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-primary-500 transition-all duration-300"
                                style={{ width: `${(((currentIdx ?? results.length) + (phase === 'done' ? 0 : 1)) / files.length) * 100}%` }}
                            />
                        </div>
                        {phase === 'done' && totalFatur > 0 && (
                            <div className="mt-3 text-sm text-slate-600">
                                Faturamento total das notas novas:{' '}
                                <span className="font-semibold text-slate-800">{fmtCurrency(totalFatur)}</span>
                            </div>
                        )}
                    </div>

                    {/* Lista de resultados */}
                    <div className="bg-slate-900 rounded-xl p-4 max-h-96 overflow-y-auto text-xs font-mono leading-relaxed">
                        {results.map((r, i) => (
                            <div key={i} className="flex items-start gap-2 py-0.5">
                                {r.status === 'pending'    && <span className="text-slate-500">⏸</span>}
                                {r.status === 'processing' && <Loader2 className="w-3 h-3 animate-spin text-primary-400 mt-0.5" />}
                                {r.status === 'success'    && <CheckCircle2 className="w-3 h-3 text-emerald-400 mt-0.5 flex-shrink-0" />}
                                {r.status === 'duplicate'  && <span className="text-amber-400">⊘</span>}
                                {r.status === 'error'      && <XCircle className="w-3 h-3 text-red-400 mt-0.5 flex-shrink-0" />}
                                <span className={
                                    r.status === 'success'    ? 'text-emerald-300' :
                                    r.status === 'duplicate'  ? 'text-amber-300' :
                                    r.status === 'error'      ? 'text-red-300' :
                                    r.status === 'processing' ? 'text-primary-300' :
                                                                'text-slate-500'
                                }>
                                    {r.fileName.replace(/^NFe/, 'NFe ')}
                                </span>
                                {r.valor !== undefined && <span className="text-slate-500 ml-1">— {fmtCurrency(r.valor)}</span>}
                                {r.motivo && <span className="text-slate-500 ml-1">— {r.motivo}</span>}
                                {r.error && <span className="text-red-400 ml-1">— {r.error}</span>}
                                {r.notaId && (r.status === 'success' || r.status === 'duplicate') && (
                                    <button
                                        onClick={() => onOpenNota(r.notaId!)}
                                        className="ml-auto text-primary-400 hover:text-primary-300 underline"
                                    >
                                        revisar
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>

                    {phase === 'done' && (
                        <div className="flex gap-2">
                            <button
                                onClick={() => { setFiles([]); setResults([]); setPhase('idle'); }}
                                className="flex-1 py-2.5 text-sm font-medium text-slate-700 border border-slate-300 rounded-xl hover:bg-slate-50"
                            >
                                Subir outro lote
                            </button>
                            <button
                                onClick={onDone}
                                className="flex-1 py-2.5 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700"
                            >
                                Ver lista de notas
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

// ── View: Revisão dos itens ────────────────────────────────────────────────

function ReviewView({
    notaId, onConfirmed, onBack,
}: {
    notaId: string;
    onConfirmed: () => void;
    onBack: () => void;
}) {
    const [nota, setNota] = useState<NotaFiscal | null>(null);
    const [itens, setItens] = useState<NfeItemComNome[]>([]);
    const [ingredients, setIngredients] = useState<Ingredient[]>([]);
    const [loading, setLoading] = useState(true);
    const [confirmando, setConfirmando] = useState(false);
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const { restauranteId } = useAuth();

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [notaRes, itensRes, ingRes] = await Promise.all([
                supabase.from('notas_fiscais').select('*').eq('id', notaId).single(),
                supabase.from('nfe_itens').select('*').eq('nota_fiscal_id', notaId).order('criado_em'),
                supabase.from('ingredients').select('id, name, unit_type, tipo').eq('restaurant_id', restauranteId!),
            ]);

            if (notaRes.data) setNota(notaRes.data as NotaFiscal);
            setIngredients((ingRes.data ?? []) as Ingredient[]);

            if (itensRes.data) {
                // Enriquece os itens com nomes dos insumos
                const ings = (ingRes.data ?? []) as Ingredient[];
                const ingMap = Object.fromEntries(ings.map(i => [i.id, i.name]));
                const enriched = (itensRes.data as NfeItem[]).map(it => ({
                    ...it,
                    insumo_sugerido_nome: it.insumo_sugerido_id ? ingMap[it.insumo_sugerido_id] : undefined,
                    insumo_confirmado_nome: it.insumo_confirmado_id ? ingMap[it.insumo_confirmado_id] : undefined,
                }));
                setItens(enriched);
            }
        } catch (err) {
            toast.error('Erro ao carregar nota: ' + String(err));
        } finally {
            setLoading(false);
        }
    }, [notaId, restauranteId]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const vinculados = itens.filter(i => i.status === 'vinculado' || i.status === 'novo_insumo').length;
    const pendentes = itens.filter(i => i.status === 'pendente').length;
    const ignorados = itens.filter(i => i.status === 'ignorado').length;
    const total = itens.length;

    // "Confirmar todas" aparece se todos os pendentes têm sugestão ≥ 80%
    const podConfirmarTodas = itens.filter(i => i.status === 'pendente').every(
        i => i.insumo_sugerido_id && (i.confianca_match ?? 0) >= 0.8
    ) && pendentes > 0;

    const handleConfirmarTodas = async () => {
        const aConfirmar = itens.filter(
            i => i.status === 'pendente' && i.insumo_sugerido_id && (i.confianca_match ?? 0) >= 0.8
        );
        try {
            await Promise.all(aConfirmar.map(i => confirmarItem(i.id, i.insumo_sugerido_id!)));
            toast.success(`${aConfirmar.length} itens confirmados!`);
            fetchData();
        } catch (err) {
            toast.error(String(err));
        }
    };

    const handleConfirmarNota = async () => {
        setConfirmando(true);
        try {
            const processados = await confirmarNfe(notaId);
            toast.success(`Nota fiscal confirmada! ${processados} insumo(s) atualizado(s) no estoque.`);
            onConfirmed();
        } catch (err) {
            toast.error(String(err));
        } finally {
            setConfirmando(false);
            setShowConfirmDialog(false);
        }
    };

    const readOnly = nota?.status !== 'pendente';

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Cabeçalho */}
            <div className="flex items-center gap-3">
                <button
                    onClick={onBack}
                    className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
                >
                    ← Voltar
                </button>
                <h2 className="text-lg font-semibold text-slate-800">Revisar itens da nota</h2>
                {nota && <StatusBadgeNota status={nota.status} />}
            </div>

            {/* Resumo da nota */}
            {nota && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                        <p className="text-xs text-slate-500">Fornecedor</p>
                        <p className="text-sm font-medium text-slate-700">{nota.fornecedor_nome ?? '—'}</p>
                        <p className="text-xs text-slate-500">{nota.fornecedor_cnpj ?? ''}</p>
                    </div>
                    <div>
                        <p className="text-xs text-slate-500">Número</p>
                        <p className="text-sm font-medium text-slate-700">NF-{nota.numero_nota ?? '—'}</p>
                    </div>
                    <div>
                        <p className="text-xs text-slate-500">Data emissão</p>
                        <p className="text-sm font-medium text-slate-700">{fmtDate(nota.data_emissao)}</p>
                    </div>
                    <div>
                        <p className="text-xs text-slate-500">Valor total</p>
                        <p className="text-sm font-semibold text-slate-800">{fmtCurrency(nota.valor_total)}</p>
                    </div>
                </div>
            )}

            {/* Progresso */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-700">
                        {vinculados} de {total} itens vinculados
                    </span>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span>{pendentes} pendentes</span>
                        <span>{ignorados} ignorados</span>
                    </div>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-primary-500 rounded-full transition-all duration-300"
                        style={{ width: total > 0 ? `${(vinculados / total) * 100}%` : '0%' }}
                    />
                </div>
                {!readOnly && podConfirmarTodas && (
                    <button
                        onClick={handleConfirmarTodas}
                        className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-700 flex items-center gap-1.5"
                    >
                        <Check className="w-4 h-4" />
                        Confirmar todas as sugestões da IA ({pendentes} itens)
                    </button>
                )}
            </div>

            {/* Tabela (desktop) */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden hidden md:block">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-slate-100 bg-slate-50">
                            <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-left">Descrição</th>
                            <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-left">Qtd</th>
                            <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-left">Vlr. Unit.</th>
                            <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-left">Total</th>
                            <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-left">Insumo sugerido</th>
                            <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-left">Status</th>
                            <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-left">Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        {itens.map(item => (
                            <ItemRow
                                key={item.id}
                                item={item}
                                ingredients={ingredients}
                                readOnly={readOnly}
                                onUpdated={fetchData}
                            />
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Cards (mobile) */}
            <div className="md:hidden space-y-2">
                {itens.map(item => (
                    <ItemRow
                        key={item.id}
                        item={item}
                        ingredients={ingredients}
                        readOnly={readOnly}
                        onUpdated={fetchData}
                    />
                ))}
            </div>

            {/* Rodapé fixo — botão confirmar nota */}
            {!readOnly && vinculados > 0 && (
                <div className="sticky bottom-0 bg-white border-t border-slate-200 p-4 -mx-4 md:-mx-6 lg:-mx-8 mt-6">
                    <button
                        onClick={() => setShowConfirmDialog(true)}
                        className="w-full md:w-auto md:px-8 py-2.5 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 transition-colors"
                    >
                        Confirmar nota ({vinculados} {vinculados === 1 ? 'item' : 'itens'} atualiza{vinculados === 1 ? 'rá' : 'rão'} o estoque)
                    </button>
                </div>
            )}

            {/* Dialog de confirmação */}
            {showConfirmDialog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center shrink-0">
                                <AlertCircle className="w-5 h-5 text-primary-600" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-slate-800">Confirmar nota fiscal?</h3>
                                <p className="text-sm text-slate-500 mt-0.5">
                                    Isso vai atualizar o custo e estoque de {vinculados} insumo(s). Esta ação não pode ser desfeita.
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowConfirmDialog(false)}
                                disabled={confirmando}
                                className="flex-1 px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleConfirmarNota}
                                disabled={confirmando}
                                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                            >
                                {confirmando && <Loader2 className="w-4 h-4 animate-spin" />}
                                Confirmar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── View: Lista de notas ───────────────────────────────────────────────────

function ListaView({
    onImportar, onImportarLote, onOpenNota, onAtualizarCustos,
}: {
    onImportar: () => void;
    onImportarLote: () => void;
    onOpenNota: (id: string) => void;
    onAtualizarCustos: () => void;
}) {
    const [notas, setNotas] = useState<NotaFiscal[]>([]);
    const [loading, setLoading] = useState(true);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [driveSync, setDriveSync] = useState<DriveSyncStatus | null>(null);
    const [buscandoDrive, setBuscandoDrive] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const { confirm } = useConfirm();

    const fetchNotas = useCallback(async () => {
        const { data, error } = await supabase
            .from('notas_fiscais')
            .select('*')
            .order('criado_em', { ascending: false });
        if (error) toast.error('Erro ao carregar notas: ' + error.message);
        setNotas((data ?? []) as NotaFiscal[]);
    }, []);

    useEffect(() => {
        (async () => {
            await fetchNotas();
            setDriveSync(await getDriveSyncStatus());
            setLoading(false);
        })();
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, [fetchNotas]);

    const handleBuscarDrive = async () => {
        setBuscandoDrive(true);
        try {
            await solicitarSyncNfe();
            toast.success('Busca solicitada! O robô puxa as notas do Drive em até 5 minutos.');
            // Poll: quando last_sync_at mudar, recarrega a lista e para.
            const syncAntes = driveSync?.last_sync_at ?? null;
            let tentativas = 0;
            pollRef.current = setInterval(async () => {
                tentativas++;
                const status = await getDriveSyncStatus();
                if (status && status.last_sync_at !== syncAntes) {
                    if (pollRef.current) clearInterval(pollRef.current);
                    setDriveSync(status);
                    setBuscandoDrive(false);
                    await fetchNotas();
                    toast.success(`Busca concluída: ${status.last_result ?? 'ok'}`);
                } else if (tentativas >= 30) { // ~10 min, desiste do poll (busca segue no servidor)
                    if (pollRef.current) clearInterval(pollRef.current);
                    setBuscandoDrive(false);
                }
            }, 20000);
        } catch (err) {
            setBuscandoDrive(false);
            toast.error(String(err));
        }
    };

    const handleDelete = async (nota: NotaFiscal) => {
        const nome = nota.fornecedor_nome ?? 'Fornecedor desconhecido';
        if (!(await confirm({
            title: `Excluir a nota de ${nome} (NF-${nota.numero_nota ?? '—'})?`,
            message: 'Os itens vinculados serão removidos. Esta ação não pode ser desfeita.',
            tone: 'danger',
            confirmText: 'Excluir',
        }))) return;
        setDeletingId(nota.id);
        try {
            await deletarNota(nota.id, nota.xml_url);
            setNotas(prev => prev.filter(n => n.id !== nota.id));
            toast.success('Nota excluída.');
        } catch (err) {
            toast.error(String(err));
        } finally {
            setDeletingId(null);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Notas Fiscais</h1>
                    <p className="text-sm text-slate-500 mt-0.5">Importe e gerencie NF-e XML</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {notas.some(n => n.status === 'pendente') && (
                        <button
                            onClick={onAtualizarCustos}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 border border-slate-300 bg-white rounded-xl hover:bg-slate-50 transition-colors shadow-sm"
                        >
                            <DollarSign className="w-4 h-4" />
                            Atualizar custos
                        </button>
                    )}
                    {driveSync?.ativo && (
                        <button
                            onClick={handleBuscarDrive}
                            disabled={buscandoDrive}
                            title={driveSync.last_result
                                ? `Última busca: ${driveSync.last_result}`
                                : 'Buscar notas novas no Drive agora'}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 border border-slate-300 bg-white rounded-xl hover:bg-slate-50 disabled:opacity-60 transition-colors shadow-sm"
                        >
                            <RefreshCw className={`w-4 h-4 ${buscandoDrive ? 'animate-spin' : ''}`} />
                            {buscandoDrive ? 'Buscando…' : 'Buscar do Drive'}
                        </button>
                    )}
                    <button
                        onClick={onImportarLote}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-700 border border-primary-300 bg-white rounded-xl hover:bg-primary-50 transition-colors shadow-sm"
                    >
                        <Files className="w-4 h-4" />
                        Upload em lote
                    </button>
                    <button
                        onClick={onImportar}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 transition-colors shadow-sm"
                    >
                        <Upload className="w-4 h-4" />
                        Importar NF-e
                    </button>
                </div>
            </div>

            {notas.length === 0 ? (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-16 text-center">
                    <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    <p className="font-medium text-slate-600">Nenhuma nota fiscal importada</p>
                    <p className="text-sm text-slate-500 mt-1">
                        Importe seu primeiro XML de NF-e para começar.
                    </p>
                    <button
                        onClick={onImportar}
                        className="mt-4 px-5 py-2 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 transition-colors"
                    >
                        Importar NF-e
                    </button>
                </div>
            ) : (
                <div className="space-y-3">
                    {notas.map(nota => (
                        <div
                            key={nota.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => onOpenNota(nota.id)}
                            onKeyDown={e => { if (e.key === 'Enter') onOpenNota(nota.id); }}
                            className="w-full text-left bg-white rounded-2xl shadow-sm border border-slate-100 p-4 hover:shadow-md transition-shadow cursor-pointer"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-9 h-9 bg-slate-100 rounded-xl flex items-center justify-center shrink-0">
                                        <FileText className="w-5 h-5 text-slate-500" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-medium text-slate-800 truncate">
                                            {nota.fornecedor_nome ?? 'Fornecedor desconhecido'}
                                        </p>
                                        <p className="text-xs text-slate-500 mt-0.5">
                                            NF-{nota.numero_nota ?? '—'} · {fmtDate(nota.data_emissao ?? nota.criado_em)}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-sm font-semibold text-slate-700">
                                        {fmtCurrency(nota.valor_total)}
                                    </span>
                                    <StatusBadgeNota status={nota.status} />
                                    <button
                                        onClick={e => { e.stopPropagation(); handleDelete(nota); }}
                                        disabled={deletingId === nota.id}
                                        title="Excluir nota"
                                        className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                    >
                                        {deletingId === nota.id
                                            ? <Loader2 className="w-4 h-4 animate-spin" />
                                            : <Trash2 className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Page principal ─────────────────────────────────────────────────────────

type View = 'list' | 'upload' | 'bulk' | 'review' | 'custos';

export function NotasFiscais() {
    const navigate = useNavigate();
    const { isDonoOrGerente } = usePermissions();
    const [view, setView] = useState<View>('list');
    const [reviewNotaId, setReviewNotaId] = useState<string | null>(null);

    if (!isDonoOrGerente) {
        navigate('/', { replace: true });
        return null;
    }

    if (view === 'upload') {
        return (
            <UploadView
                onUploaded={(notaId) => {
                    setReviewNotaId(notaId);
                    setView('review');
                }}
            />
        );
    }

    if (view === 'bulk') {
        return (
            <BulkUploadView
                onDone={() => setView('list')}
                onOpenNota={(id) => { setReviewNotaId(id); setView('review'); }}
            />
        );
    }

    if (view === 'custos') {
        return (
            <AtualizarCustosNfe
                onBack={() => setView('list')}
                onDone={() => setView('list')}
            />
        );
    }

    if (view === 'review' && reviewNotaId) {
        return (
            <ReviewView
                notaId={reviewNotaId}
                onConfirmed={() => setView('list')}
                onBack={() => setView('list')}
            />
        );
    }

    return (
        <ListaView
            onImportar={() => setView('upload')}
            onImportarLote={() => setView('bulk')}
            onAtualizarCustos={() => setView('custos')}
            onOpenNota={(id) => {
                setReviewNotaId(id);
                setView('review');
            }}
        />
    );
}
