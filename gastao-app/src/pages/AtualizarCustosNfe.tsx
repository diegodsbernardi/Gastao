import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
    AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronRight,
    Loader2, TrendingDown, TrendingUp,
} from 'lucide-react';
import { PreviaCustoNfe, previaCustosNfe, aplicarCustosNfe } from '../lib/nfe';
import { fmtMoney } from '../lib/format';
import { ConfidenceBadge } from './NotasFiscais';

// Tela de atualização de custos a partir das notas pendentes (Frente A).
// Prévia agrupada por insumo; o servidor recalcula tudo na aplicação —
// daqui saem apenas os UUIDs dos itens marcados. NÃO confirma notas
// e NÃO altera estoque.

const LIMITE_SUSPEITO = 300; // |variação %| ≥ isso vem desmarcado (anti-corrupção)

interface Grupo {
    insumoId: string;
    nome: string;
    unidade: string;
    custoAtual: number | null;
    vencedor: PreviaCustoNfe | null; // item mais recente conversível
    itens: PreviaCustoNfe[];
}

export function AtualizarCustosNfe({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
    const [rows, setRows] = useState<PreviaCustoNfe[]>([]);
    const [loading, setLoading] = useState(true);
    const [checked, setChecked] = useState<Set<string>>(new Set());
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [confirming, setConfirming] = useState(false);
    const [applying, setApplying] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const data = await previaCustosNfe();
                setRows(data);
                // Default: marcados os conversíveis com custo válido e variação não-suspeita
                setChecked(new Set(
                    data.filter(r =>
                        r.fator != null && (r.custo_novo ?? 0) > 0 &&
                        Math.abs(r.variacao_pct ?? 0) < LIMITE_SUSPEITO,
                    ).map(r => r.item_id),
                ));
            } catch (err) {
                toast.error(String(err));
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const grupos = useMemo<Grupo[]>(() => {
        const map = new Map<string, Grupo>();
        for (const r of rows) {
            if (!map.has(r.insumo_id)) {
                map.set(r.insumo_id, {
                    insumoId: r.insumo_id, nome: r.insumo_nome, unidade: r.insumo_unidade,
                    custoAtual: r.custo_atual, vencedor: null, itens: [],
                });
            }
            const g = map.get(r.insumo_id)!;
            g.itens.push(r);
            if (r.eh_mais_recente && r.fator != null) g.vencedor = r;
        }
        return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
    }, [rows]);

    const marcados = checked.size;

    const toggle = (itemId: string, disabled: boolean) => {
        if (disabled) return;
        setChecked(prev => {
            const next = new Set(prev);
            if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
            return next;
        });
    };

    const toggleExpand = (insumoId: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(insumoId)) next.delete(insumoId); else next.add(insumoId);
            return next;
        });
    };

    const handleAplicar = async () => {
        setApplying(true);
        try {
            const n = await aplicarCustosNfe(Array.from(checked));
            toast.success(`Custos atualizados: ${n} insumo${n !== 1 ? 's' : ''}.`);
            onDone();
        } catch (err) {
            toast.error(String(err));
            setApplying(false);
            setConfirming(false);
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
        <div className="space-y-6 pb-24">
            <div className="flex items-center gap-3">
                <button
                    onClick={onBack}
                    className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                    aria-label="Voltar"
                >
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Atualizar custos pelas notas</h1>
                    <p className="text-sm text-slate-500 mt-0.5">
                        Preço da compra mais recente vence. Isso <strong>não confirma notas</strong> e <strong>não altera estoque</strong>.
                    </p>
                </div>
            </div>

            {grupos.length === 0 ? (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-16 text-center">
                    <Check className="w-12 h-12 text-green-400 mx-auto mb-3" />
                    <p className="font-medium text-slate-600">Nada pra atualizar</p>
                    <p className="text-sm text-slate-500 mt-1">
                        Todos os itens de notas pendentes já tiveram o custo aplicado (ou não têm insumo vinculado).
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {grupos.map(g => {
                        const v = g.vencedor;
                        const variacao = v?.variacao_pct ?? null;
                        const subiu = (variacao ?? 0) > 0;
                        const isOpen = expanded.has(g.insumoId);
                        return (
                            <div key={g.insumoId} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                <button
                                    onClick={() => toggleExpand(g.insumoId)}
                                    className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-slate-50 transition-colors"
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        {isOpen ? <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />}
                                        <span className="font-semibold text-slate-800 truncate">{g.nome}</span>
                                        <span className="text-xs text-slate-500">[{g.unidade}]</span>
                                        <span className="text-xs text-slate-500">· {g.itens.length} item{g.itens.length !== 1 ? 's' : ''}</span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0 text-sm">
                                        {v ? (
                                            <>
                                                <span className="text-slate-500">{fmtMoney(g.custoAtual ?? 0)}/{g.unidade}</span>
                                                <span className="text-slate-500">→</span>
                                                <span className="font-semibold text-slate-800">{fmtMoney(v.custo_novo ?? 0)}/{g.unidade}</span>
                                                {variacao != null && (
                                                    <span className={`inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded-full ${subiu ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                                                        {subiu ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                                                        {variacao > 0 ? '+' : ''}{variacao.toFixed(1)}%
                                                    </span>
                                                )}
                                            </>
                                        ) : (
                                            <span className="text-xs text-amber-600 flex items-center gap-1">
                                                <AlertTriangle className="w-3.5 h-3.5" /> sem conversão de unidade
                                            </span>
                                        )}
                                    </div>
                                </button>

                                {isOpen && (
                                    <ul className="border-t border-slate-100 divide-y divide-slate-50">
                                        {g.itens.map(item => {
                                            const semConversao = item.fator == null;
                                            const suspeito = Math.abs(item.variacao_pct ?? 0) >= LIMITE_SUSPEITO;
                                            const isChecked = checked.has(item.item_id);
                                            return (
                                                <li
                                                    key={item.item_id}
                                                    className={`flex items-start gap-3 px-4 py-3 ${semConversao ? 'opacity-60' : ''} ${suspeito ? 'bg-red-50/60' : ''}`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        className="mt-1 w-4 h-4 accent-primary-600 disabled:cursor-not-allowed"
                                                        checked={isChecked}
                                                        disabled={semConversao}
                                                        onChange={() => toggle(item.item_id, semConversao)}
                                                    />
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-sm text-slate-700 truncate">{item.descricao_xml}</p>
                                                        <p className="text-xs text-slate-500 mt-0.5">
                                                            {item.fornecedor ?? '—'} · NF-{item.numero_nota ?? '—'} · {item.data_emissao ? new Date(item.data_emissao).toLocaleDateString('pt-BR') : '—'}
                                                            {' · '}{fmtMoney(item.valor_unit_nota)}/{item.unidade_nota}
                                                            {item.fator != null && ` → ${fmtMoney(item.custo_novo ?? 0)}/${item.insumo_unidade}`}
                                                        </p>
                                                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                                                                {item.origem === 'drive' ? 'Drive' : 'Upload'}
                                                            </span>
                                                            {item.origem_match === 'sugerido' && (
                                                                <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-primary-50 text-primary-700">
                                                                    Sugestão IA <ConfidenceBadge v={item.confianca} />
                                                                </span>
                                                            )}
                                                            {item.eh_mais_recente && item.fator != null && (
                                                                <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-50 text-green-700">mais recente</span>
                                                            )}
                                                            {semConversao && (
                                                                <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">
                                                                    sem conversão: {item.unidade_nota} → {item.insumo_unidade}
                                                                </span>
                                                            )}
                                                            {suspeito && (
                                                                <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                                                                    <AlertTriangle className="w-3 h-3" /> variação {item.variacao_pct! > 0 ? '+' : ''}{item.variacao_pct!.toFixed(0)}% — confira a embalagem
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Rodapé sticky */}
            {grupos.length > 0 && (
                <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-slate-200 px-4 py-3 z-40">
                    <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
                        <p className="text-sm text-slate-600">
                            <strong>{marcados}</strong> item{marcados !== 1 ? 's' : ''} marcado{marcados !== 1 ? 's' : ''}
                            {' '}· por insumo, vale a nota mais recente
                        </p>
                        <button
                            onClick={() => setConfirming(true)}
                            disabled={marcados === 0 || applying}
                            className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-50 transition-colors shadow-sm"
                        >
                            <Check className="w-4 h-4" />
                            Aplicar custos
                        </button>
                    </div>
                </div>
            )}

            {/* Dialog de confirmação */}
            {confirming && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
                        <h2 className="text-lg font-bold text-slate-800">Aplicar custos das notas?</h2>
                        <p className="text-sm text-slate-600 mt-2">
                            Os custos dos insumos serão atualizados pelo preço da compra mais recente marcada.
                            Isso <strong>não confirma as notas</strong> e <strong>não altera o estoque</strong> —
                            variações grandes vão gerar alertas de CMV no Dashboard.
                        </p>
                        <div className="flex justify-end gap-2 mt-5">
                            <button
                                onClick={() => setConfirming(false)}
                                disabled={applying}
                                className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleAplicar}
                                disabled={applying}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-60 transition-colors"
                            >
                                {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                Aplicar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
