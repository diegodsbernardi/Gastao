import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
    AlertCircle, Check, ChevronDown, FileText, Loader2,
    Plus, Search, Upload, X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
    confirmarItem, confirmarNfe, criarInsumoDeNfe, ignorarItem,
    NotaFiscal, NfeItem, uploadNfeXml,
} from '../lib/nfe';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';

// ── Types ─────────────────────────────────────────────────────────────────

interface Ingredient { id: string; name: string; unit_type: string; type: string; }

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

function ConfidenceBadge({ v }: { v: number | null }) {
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
        ignorado:    'bg-slate-100 text-slate-400',
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

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [onClose]);

    return (
        <div
            ref={ref}
            className="absolute z-50 right-0 mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden"
        >
            <div className="p-2 border-b border-slate-100">
                <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 rounded-lg">
                    <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <input
                        autoFocus
                        className="flex-1 bg-transparent text-sm outline-none placeholder-slate-400"
                        placeholder="Buscar insumo…"
                        value={q}
                        onChange={e => setQ(e.target.value)}
                    />
                </div>
            </div>
            <ul className="max-h-48 overflow-y-auto">
                {filtered.length === 0 && (
                    <li className="px-3 py-2 text-sm text-slate-400">Nenhum resultado</li>
                )}
                {filtered.map(ing => (
                    <li key={ing.id}>
                        <button
                            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 transition-colors"
                            onClick={() => { onSelect(ing.id, ing.name); onClose(); }}
                        >
                            <span className="font-medium text-slate-700">{ing.name}</span>
                            <span className="text-slate-400 ml-1">({ing.unit_type})</span>
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
    const [name, setName] = useState(item.descricao_xml);
    const [unitType, setUnitType] = useState(item.unidade.toUpperCase());
    const [type, setType] = useState('insumo');
    const [avgCost, setAvgCost] = useState(String(item.valor_unitario));
    const [stockQty, setStockQty] = useState(String(item.quantidade));
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        setSaving(true);
        try {
            await criarInsumoDeNfe(item.id, {
                name: name.trim(),
                unit_type: unitType,
                type,
                avg_cost_per_unit: parseFloat(avgCost) || item.valor_unitario,
                stock_quantity: parseFloat(stockQty) || 0,
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
                    <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors">
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
                                onChange={e => setUnitType(e.target.value.toUpperCase())}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Tipo</label>
                            <select
                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                                value={type}
                                onChange={e => setType(e.target.value)}
                            >
                                <option value="insumo">Insumo</option>
                                <option value="bebida">Bebida</option>
                                <option value="embalagem">Embalagem</option>
                                <option value="descartavel">Descartável</option>
                                <option value="limpeza">Limpeza</option>
                                <option value="outros">Outros</option>
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Custo unitário (R$)</label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                                value={avgCost}
                                onChange={e => setAvgCost(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Qtd inicial</label>
                            <input
                                type="number"
                                step="0.001"
                                min="0"
                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                                value={stockQty}
                                onChange={e => setStockQty(e.target.value)}
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
                    {item.codigo_produto && <div className="text-xs text-slate-400">{item.codigo_produto}</div>}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                    {item.quantidade} {item.unidade}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                    {fmtCurrency(item.valor_unitario)}
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
                        <span className="text-slate-400 text-xs">Nenhum encontrado</span>
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
                                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-400 border border-slate-200 rounded-lg hover:bg-slate-100 disabled:opacity-50 transition-colors"
                            >
                                {loadingAction === 'ignorar'
                                    ? <Loader2 className="w-3 h-3 animate-spin" />
                                    : <X className="w-3 h-3" />}
                                Ignorar
                            </button>
                        </div>
                    )}
                    {!readOnly && item.status !== 'pendente' && (
                        <span className="text-xs text-slate-400">—</span>
                    )}
                </td>
            </tr>

            {/* Mobile card */}
            <div className="md:hidden bg-white border border-slate-200 rounded-xl p-4 space-y-3 mb-2">
                <div className="flex items-start justify-between gap-2">
                    <div>
                        <p className="text-sm font-medium text-slate-800">{item.descricao_xml}</p>
                        {item.codigo_produto && <p className="text-xs text-slate-400">{item.codigo_produto}</p>}
                    </div>
                    <StatusBadgeItem status={item.status} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-slate-500">
                    <div><span className="font-medium">Qtd:</span> {item.quantidade} {item.unidade}</div>
                    <div><span className="font-medium">Unit:</span> {fmtCurrency(item.valor_unitario)}</div>
                    <div><span className="font-medium">Total:</span> {fmtCurrency(item.valor_total)}</div>
                </div>
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
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-400 border border-slate-200 rounded-lg hover:bg-slate-100 disabled:opacity-50"
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
                <Upload className={`w-10 h-10 mx-auto mb-3 ${isDragging ? 'text-primary-500' : 'text-slate-400'}`} />
                {file ? (
                    <div>
                        <p className="font-medium text-slate-700">{file.name}</p>
                        <p className="text-sm text-slate-400 mt-0.5">{fmtFileSize(file.size)}</p>
                    </div>
                ) : (
                    <div>
                        <p className="text-slate-600 font-medium">Arraste o XML da nota fiscal</p>
                        <p className="text-sm text-slate-400 mt-1">ou clique para selecionar</p>
                        <p className="text-xs text-slate-400 mt-3">Apenas arquivos .xml até 5 MB</p>
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
                supabase.from('ingredients').select('id, name, unit_type, type').eq('restaurant_id', restauranteId!),
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
                        <p className="text-xs text-slate-400">Fornecedor</p>
                        <p className="text-sm font-medium text-slate-700">{nota.fornecedor_nome ?? '—'}</p>
                        <p className="text-xs text-slate-400">{nota.fornecedor_cnpj ?? ''}</p>
                    </div>
                    <div>
                        <p className="text-xs text-slate-400">Número</p>
                        <p className="text-sm font-medium text-slate-700">NF-{nota.numero_nota ?? '—'}</p>
                    </div>
                    <div>
                        <p className="text-xs text-slate-400">Data emissão</p>
                        <p className="text-sm font-medium text-slate-700">{fmtDate(nota.data_emissao)}</p>
                    </div>
                    <div>
                        <p className="text-xs text-slate-400">Valor total</p>
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
                    <div className="flex items-center gap-3 text-xs text-slate-400">
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
    onImportar, onOpenNota,
}: {
    onImportar: () => void;
    onOpenNota: (id: string) => void;
}) {
    const [notas, setNotas] = useState<NotaFiscal[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            const { data, error } = await supabase
                .from('notas_fiscais')
                .select('*')
                .order('criado_em', { ascending: false });

            if (error) toast.error('Erro ao carregar notas: ' + error.message);
            setNotas((data ?? []) as NotaFiscal[]);
            setLoading(false);
        })();
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Notas Fiscais</h1>
                    <p className="text-sm text-slate-500 mt-0.5">Importe e gerencie NF-e XML</p>
                </div>
                <button
                    onClick={onImportar}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 transition-colors shadow-sm"
                >
                    <Upload className="w-4 h-4" />
                    Importar NF-e
                </button>
            </div>

            {notas.length === 0 ? (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-16 text-center">
                    <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    <p className="font-medium text-slate-600">Nenhuma nota fiscal importada</p>
                    <p className="text-sm text-slate-400 mt-1">
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
                        <button
                            key={nota.id}
                            onClick={() => onOpenNota(nota.id)}
                            className="w-full text-left bg-white rounded-2xl shadow-sm border border-slate-100 p-4 hover:shadow-md transition-shadow"
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
                                        <p className="text-xs text-slate-400 mt-0.5">
                                            NF-{nota.numero_nota ?? '—'} · {fmtDate(nota.criado_em)}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-sm font-semibold text-slate-700">
                                        {fmtCurrency(nota.valor_total)}
                                    </span>
                                    <StatusBadgeNota status={nota.status} />
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Page principal ─────────────────────────────────────────────────────────

type View = 'list' | 'upload' | 'review';

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
            onOpenNota={(id) => {
                setReviewNotaId(id);
                setView('review');
            }}
        />
    );
}
