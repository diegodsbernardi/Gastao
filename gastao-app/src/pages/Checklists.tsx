import React, { useEffect, useState } from 'react';
import {
    ClipboardList, Plus, Check, Loader2, X, Trash2, ChevronRight, ArrowLeft, CircleCheck,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { toast } from 'sonner';

type Frequencia = 'diario' | 'semanal' | 'mensal' | 'avulso';
type RunStatus = 'em_andamento' | 'concluido' | 'cancelado';

interface Template {
    id: string;
    nome: string;
    descricao: string | null;
    frequencia: Frequencia;
    ativo: boolean;
    criado_em: string;
}

interface TemplateItem {
    id: string;
    template_id: string;
    position: number;
    titulo: string;
    descricao: string | null;
    requer_nota: boolean;
}

interface Run {
    id: string;
    template_id: string;
    data_referencia: string;
    status: RunStatus;
    iniciado_em: string;
    concluido_em: string | null;
}

interface RunItem {
    id: string;
    run_id: string;
    template_item_id: string;
    feito: boolean;
    feito_em: string | null;
    nota: string | null;
}

const FREQ_LABEL: Record<Frequencia, string> = {
    diario: 'Diário',
    semanal: 'Semanal',
    mensal: 'Mensal',
    avulso: 'Avulso',
};

const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const Checklists = () => {
    const { restauranteId } = useAuth();
    const { isDonoOrGerente } = usePermissions();

    const [templates, setTemplates] = useState<Template[]>([]);
    const [todaysRuns, setTodaysRuns] = useState<Run[]>([]);
    const [runProgress, setRunProgress] = useState<Record<string, { done: number; total: number }>>({});
    const [loading, setLoading] = useState(true);

    // Modal: criar template
    const [showCreate, setShowCreate] = useState(false);
    const [newNome, setNewNome] = useState('');
    const [newDescricao, setNewDescricao] = useState('');
    const [newFreq, setNewFreq] = useState<Frequencia>('diario');
    const [newItems, setNewItems] = useState<string[]>(['']);
    const [creating, setCreating] = useState(false);

    // View: executar checklist
    const [activeRunId, setActiveRunId] = useState<string | null>(null);
    const [activeTemplate, setActiveTemplate] = useState<Template | null>(null);
    const [activeItems, setActiveItems] = useState<(RunItem & { titulo: string; descricao: string | null; requer_nota: boolean; position: number })[]>([]);
    const [loadingRun, setLoadingRun] = useState(false);
    const [savingItemId, setSavingItemId] = useState<string | null>(null);

    useEffect(() => {
        if (restauranteId) loadData();
    }, [restauranteId]);

    const loadData = async () => {
        setLoading(true);
        const today = todayISO();

        const [tplRes, runRes] = await Promise.all([
            supabase.from('checklist_templates')
                .select('*')
                .eq('ativo', true)
                .order('criado_em', { ascending: true }),
            supabase.from('checklist_runs')
                .select('*')
                .eq('data_referencia', today)
                .order('iniciado_em', { ascending: false }),
        ]);

        const tpls = (tplRes.data ?? []) as Template[];
        const runs = (runRes.data ?? []) as Run[];
        setTemplates(tpls);
        setTodaysRuns(runs);

        // Calcular progresso das runs de hoje
        if (runs.length > 0) {
            const runIds = runs.map(r => r.id);
            const { data: items } = await supabase
                .from('checklist_run_items')
                .select('run_id, feito')
                .in('run_id', runIds);

            const prog: Record<string, { done: number; total: number }> = {};
            runs.forEach(r => { prog[r.id] = { done: 0, total: 0 }; });
            (items ?? []).forEach((i: any) => {
                prog[i.run_id].total += 1;
                if (i.feito) prog[i.run_id].done += 1;
            });
            setRunProgress(prog);
        } else {
            setRunProgress({});
        }

        setLoading(false);
    };

    const openOrStartRun = async (tpl: Template) => {
        setLoadingRun(true);
        setActiveTemplate(tpl);

        const { data: runId, error } = await supabase.rpc('start_checklist_run', {
            p_template_id: tpl.id,
        });

        if (error) {
            toast.error('Não consegui abrir o checklist.', { description: error.message });
            setLoadingRun(false);
            setActiveTemplate(null);
            return;
        }

        setActiveRunId(runId as string);
        await loadRunItems(runId as string);
        setLoadingRun(false);
    };

    const loadRunItems = async (runId: string) => {
        const { data: runItems } = await supabase
            .from('checklist_run_items')
            .select('*, checklist_template_items(titulo, descricao, requer_nota, position)')
            .eq('run_id', runId);

        const mapped = (runItems ?? []).map((ri: any) => ({
            id: ri.id,
            run_id: ri.run_id,
            template_item_id: ri.template_item_id,
            feito: ri.feito,
            feito_em: ri.feito_em,
            nota: ri.nota,
            titulo: ri.checklist_template_items?.titulo ?? '',
            descricao: ri.checklist_template_items?.descricao ?? null,
            requer_nota: ri.checklist_template_items?.requer_nota ?? false,
            position: ri.checklist_template_items?.position ?? 0,
        }));
        mapped.sort((a, b) => a.position - b.position);
        setActiveItems(mapped);
    };

    const toggleItem = async (item: typeof activeItems[number]) => {
        setSavingItemId(item.id);
        const newFeito = !item.feito;
        const { error } = await supabase
            .from('checklist_run_items')
            .update({
                feito: newFeito,
                feito_em: newFeito ? new Date().toISOString() : null,
            })
            .eq('id', item.id);

        if (error) {
            toast.error('Não consegui salvar.');
        } else {
            setActiveItems(prev => prev.map(i =>
                i.id === item.id ? { ...i, feito: newFeito } : i
            ));
        }
        setSavingItemId(null);
    };

    const finishRun = async () => {
        if (!activeRunId) return;
        const pending = activeItems.filter(i => !i.feito).length;
        if (pending > 0 && !confirm(`Ainda faltam ${pending} item(ns). Concluir mesmo assim?`)) return;

        const { error } = await supabase.rpc('complete_checklist_run', { p_run_id: activeRunId });
        if (error) {
            toast.error('Não consegui concluir.', { description: error.message });
            return;
        }
        toast.success('Checklist concluído. Bom trabalho!');
        backToList();
        loadData();
    };

    const backToList = () => {
        setActiveRunId(null);
        setActiveTemplate(null);
        setActiveItems([]);
    };

    const addItemInput = () => setNewItems([...newItems, '']);
    const removeItemInput = (idx: number) => setNewItems(newItems.filter((_, i) => i !== idx));
    const updateItemInput = (idx: number, v: string) => {
        const copy = [...newItems];
        copy[idx] = v;
        setNewItems(copy);
    };

    const createTemplate = async () => {
        if (!newNome.trim()) {
            toast.error('Dá um nome pro checklist.');
            return;
        }
        const validItems = newItems.map(i => i.trim()).filter(Boolean);
        if (validItems.length === 0) {
            toast.error('Adiciona pelo menos um item.');
            return;
        }

        setCreating(true);
        const { data: tpl, error: tplErr } = await supabase
            .from('checklist_templates')
            .insert({
                restaurant_id: restauranteId,
                nome: newNome.trim(),
                descricao: newDescricao.trim() || null,
                frequencia: newFreq,
            })
            .select()
            .single();

        if (tplErr || !tpl) {
            toast.error('Não consegui criar o template.', { description: tplErr?.message });
            setCreating(false);
            return;
        }

        const itemsPayload = validItems.map((titulo, idx) => ({
            template_id: tpl.id,
            position: idx,
            titulo,
        }));
        const { error: itemsErr } = await supabase
            .from('checklist_template_items')
            .insert(itemsPayload);

        if (itemsErr) {
            toast.error('Template criado, mas falhou ao salvar os itens.');
        } else {
            toast.success('Checklist criado.');
        }

        setCreating(false);
        setShowCreate(false);
        setNewNome('');
        setNewDescricao('');
        setNewFreq('diario');
        setNewItems(['']);
        loadData();
    };

    const deleteTemplate = async (tpl: Template) => {
        if (!confirm(`Apagar o checklist "${tpl.nome}"? Histórico de runs será mantido.`)) return;
        const { error } = await supabase
            .from('checklist_templates')
            .update({ ativo: false })
            .eq('id', tpl.id);
        if (error) {
            toast.error('Não consegui apagar.');
        } else {
            toast.success('Checklist arquivado.');
            loadData();
        }
    };

    // ────────────────────────────────────────────────────────────────
    // VIEW: Executando um checklist
    // ────────────────────────────────────────────────────────────────
    if (activeRunId && activeTemplate) {
        const doneCount = activeItems.filter(i => i.feito).length;
        const totalCount = activeItems.length;
        const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

        return (
            <div className="max-w-3xl mx-auto space-y-6">
                <button
                    onClick={backToList}
                    className="flex items-center gap-2 text-sm text-warm-gray hover:text-ink transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Voltar
                </button>

                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="h-1 bg-primary-500" />
                    <div className="p-6">
                        <h1 className="text-2xl font-bold text-ink">{activeTemplate.nome}</h1>
                        {activeTemplate.descricao && (
                            <p className="text-sm text-warm-gray mt-1">{activeTemplate.descricao}</p>
                        )}

                        <div className="mt-4">
                            <div className="flex items-center justify-between text-sm mb-2">
                                <span className="text-warm-gray">Progresso</span>
                                <span className="font-semibold text-ink tabular-nums">{doneCount}/{totalCount}</span>
                            </div>
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-primary-500 transition-all"
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {loadingRun ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
                    </div>
                ) : (
                    <div className="space-y-2">
                        {activeItems.map(item => (
                            <button
                                key={item.id}
                                onClick={() => toggleItem(item)}
                                disabled={savingItemId === item.id}
                                className={`w-full text-left bg-white rounded-xl border shadow-sm p-4 flex items-start gap-3 transition-all hover:shadow-md disabled:opacity-60 ${
                                    item.feito
                                        ? 'border-success-200 bg-success-50/30'
                                        : 'border-slate-200'
                                }`}
                            >
                                <div className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                                    item.feito
                                        ? 'bg-success-500 text-white'
                                        : 'bg-slate-100 border-2 border-slate-300'
                                }`}>
                                    {item.feito && <Check className="w-4 h-4" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className={`font-medium ${item.feito ? 'text-warm-gray line-through' : 'text-ink'}`}>
                                        {item.titulo}
                                    </p>
                                    {item.descricao && (
                                        <p className="text-sm text-warm-gray mt-0.5">{item.descricao}</p>
                                    )}
                                </div>
                                {savingItemId === item.id && (
                                    <Loader2 className="w-4 h-4 animate-spin text-primary-500" />
                                )}
                            </button>
                        ))}
                    </div>
                )}

                <div className="sticky bottom-4 md:static flex justify-end">
                    <button
                        onClick={finishRun}
                        className="bg-primary-600 hover:bg-primary-700 text-white font-semibold px-6 py-3 rounded-xl shadow-lg shadow-primary-200 flex items-center gap-2 transition-all"
                    >
                        <CircleCheck className="w-5 h-5" />
                        Concluir checklist
                    </button>
                </div>
            </div>
        );
    }

    // ────────────────────────────────────────────────────────────────
    // VIEW: Lista de templates
    // ────────────────────────────────────────────────────────────────
    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-ink">Checklists</h1>
                    <p className="text-warm-gray text-sm mt-0.5">
                        Rotinas da sua operação — do jeito que você quer que seja feito.
                    </p>
                </div>
                {isDonoOrGerente && (
                    <button
                        onClick={() => setShowCreate(true)}
                        className="bg-primary-600 hover:bg-primary-700 text-white font-semibold px-4 py-2.5 rounded-xl shadow-sm flex items-center gap-2 transition-all self-start sm:self-auto"
                    >
                        <Plus className="w-4 h-4" />
                        Novo checklist
                    </button>
                )}
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
                </div>
            ) : templates.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center">
                    <ClipboardList className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    <p className="font-semibold text-ink">Nenhum checklist por aqui ainda</p>
                    <p className="text-sm text-warm-gray mt-1">
                        Cria o primeiro — abertura, fechamento, limpeza da cozinha. Qualquer rotina que precisa acontecer todo dia.
                    </p>
                    {isDonoOrGerente && (
                        <button
                            onClick={() => setShowCreate(true)}
                            className="mt-5 bg-primary-600 hover:bg-primary-700 text-white font-semibold px-4 py-2.5 rounded-xl shadow-sm inline-flex items-center gap-2"
                        >
                            <Plus className="w-4 h-4" />
                            Criar primeiro checklist
                        </button>
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {templates.map(tpl => {
                        const run = todaysRuns.find(r => r.template_id === tpl.id);
                        const prog = run ? runProgress[run.id] : null;
                        const concluido = run?.status === 'concluido';
                        const pct = prog && prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0;

                        return (
                            <div
                                key={tpl.id}
                                className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow group"
                            >
                                <div className={`h-1 ${concluido ? 'bg-success-500' : 'bg-primary-500'}`} />
                                <div className="p-5">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <h3 className="font-bold text-ink truncate">{tpl.nome}</h3>
                                                <span className="text-xs font-medium px-2 py-0.5 bg-slate-100 text-warm-gray rounded-full">
                                                    {FREQ_LABEL[tpl.frequencia]}
                                                </span>
                                            </div>
                                            {tpl.descricao && (
                                                <p className="text-sm text-warm-gray mt-1 line-clamp-2">{tpl.descricao}</p>
                                            )}
                                        </div>
                                        {isDonoOrGerente && (
                                            <button
                                                onClick={() => deleteTemplate(tpl)}
                                                className="text-slate-300 hover:text-red-500 p-1 transition-colors opacity-0 group-hover:opacity-100"
                                                aria-label="Apagar"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>

                                    {run && prog && (
                                        <div className="mt-4">
                                            <div className="flex items-center justify-between text-xs mb-1.5">
                                                <span className={concluido ? 'text-success-600 font-semibold' : 'text-warm-gray'}>
                                                    {concluido ? 'Concluído hoje' : 'Em andamento'}
                                                </span>
                                                <span className="text-warm-gray tabular-nums font-medium">{prog.done}/{prog.total}</span>
                                            </div>
                                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full transition-all ${concluido ? 'bg-success-500' : 'bg-primary-500'}`}
                                                    style={{ width: `${pct}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    <button
                                        onClick={() => openOrStartRun(tpl)}
                                        className="mt-4 w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-primary-50 text-ink hover:text-primary-700 rounded-xl font-semibold text-sm transition-colors"
                                    >
                                        <span>
                                            {concluido ? 'Ver checklist de hoje' : run ? 'Continuar' : 'Abrir checklist de hoje'}
                                        </span>
                                        <ChevronRight className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Modal: criar template */}
            {showCreate && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col">
                        <div className="flex items-center justify-between p-5 border-b border-slate-100">
                            <h2 className="font-bold text-lg text-ink">Novo checklist</h2>
                            <button
                                onClick={() => setShowCreate(false)}
                                className="text-slate-400 hover:text-slate-600 p-1"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-5 space-y-4 overflow-y-auto">
                            <div>
                                <label className="block text-sm font-semibold text-ink mb-1">Nome</label>
                                <input
                                    type="text"
                                    value={newNome}
                                    onChange={e => setNewNome(e.target.value)}
                                    placeholder="Ex: Abertura do bar"
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-ink mb-1">Descrição (opcional)</label>
                                <input
                                    type="text"
                                    value={newDescricao}
                                    onChange={e => setNewDescricao(e.target.value)}
                                    placeholder="Pra que serve esse checklist?"
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-ink mb-1">Frequência</label>
                                <div className="grid grid-cols-4 gap-2">
                                    {(['diario', 'semanal', 'mensal', 'avulso'] as Frequencia[]).map(f => (
                                        <button
                                            key={f}
                                            type="button"
                                            onClick={() => setNewFreq(f)}
                                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                                newFreq === f
                                                    ? 'bg-primary-600 text-white'
                                                    : 'bg-slate-100 text-warm-gray hover:bg-slate-200'
                                            }`}
                                        >
                                            {FREQ_LABEL[f]}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-ink mb-2">Itens</label>
                                <div className="space-y-2">
                                    {newItems.map((item, idx) => (
                                        <div key={idx} className="flex items-center gap-2">
                                            <span className="text-xs text-warm-gray w-5 tabular-nums">{idx + 1}.</span>
                                            <input
                                                type="text"
                                                value={item}
                                                onChange={e => updateItemInput(idx, e.target.value)}
                                                placeholder={`Item ${idx + 1}`}
                                                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
                                            />
                                            {newItems.length > 1 && (
                                                <button
                                                    onClick={() => removeItemInput(idx)}
                                                    className="text-slate-400 hover:text-red-500 p-1"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                <button
                                    onClick={addItemInput}
                                    className="mt-2 text-sm text-primary-600 hover:text-primary-700 font-semibold flex items-center gap-1"
                                >
                                    <Plus className="w-4 h-4" />
                                    Adicionar item
                                </button>
                            </div>
                        </div>

                        <div className="p-5 border-t border-slate-100 flex items-center justify-end gap-2">
                            <button
                                onClick={() => setShowCreate(false)}
                                className="px-4 py-2 text-warm-gray hover:text-ink font-medium"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={createTemplate}
                                disabled={creating}
                                className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg flex items-center gap-2"
                            >
                                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                Criar checklist
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
