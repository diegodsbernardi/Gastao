import React, { useEffect, useMemo, useState } from 'react';
import {
    MessageCircle, Plus, Loader2, X, Check, ArrowLeft,
    CalendarRange, Sparkles, Target, ListChecks, CalendarClock,
    ShieldCheck, Edit3, Trash2, AlertCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { toast } from 'sonner';

// ─── Tipos ────────────────────────────────────────────────────────────────
interface Feedback {
    id: string;
    funcionario_id: string;
    funcionario_nome: string;
    funcionario_email: string;
    autor_id: string;
    autor_nome: string;
    periodo_inicio: string;       // 'YYYY-MM-DD'
    periodo_fim: string;
    pontos_positivos: string;
    pontos_melhoria: string;
    plano_acao: string;
    proximo_encontro: string | null;
    acknowledged_at: string | null;
    criado_em: string;
    atualizado_em: string;
    sou_autor: boolean;
    sou_funcionario: boolean;
}

interface Membro {
    id: string;
    usuario_id: string;
    nome: string;
    email: string;
    perfil: string;
}

type View = 'list' | 'detail' | 'form';

// ─── Helpers ──────────────────────────────────────────────────────────────
const fmtDate = (iso: string | null | undefined) => {
    if (!iso) return '—';
    const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
};

const fmtPeriodo = (inicio: string, fim: string) => `${fmtDate(inicio)} → ${fmtDate(fim)}`;

const todayISO = () => new Date().toISOString().slice(0, 10);
const lastMonthISO = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
};
const nextMonthISO = () => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
};

// ─── Componente principal ─────────────────────────────────────────────────
export const Feedbacks = () => {
    const { user } = useAuth();
    const { isDonoOrGerente } = usePermissions();

    const [view, setView] = useState<View>('list');
    const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
    const [loading, setLoading] = useState(true);
    const [members, setMembers] = useState<Membro[]>([]);

    // Detail
    const [activeId, setActiveId] = useState<string | null>(null);
    const active = useMemo(() => feedbacks.find(f => f.id === activeId) ?? null, [feedbacks, activeId]);

    // Form (criar OU editar)
    const [editingId, setEditingId] = useState<string | null>(null);
    const [funcionarioId, setFuncionarioId] = useState<string>('');
    const [periodoInicio, setPeriodoInicio] = useState<string>(lastMonthISO());
    const [periodoFim, setPeriodoFim] = useState<string>(todayISO());
    const [pontosPositivos, setPontosPositivos] = useState('');
    const [pontosMelhoria, setPontosMelhoria] = useState('');
    const [planoAcao, setPlanoAcao] = useState('');
    const [proximoEncontro, setProximoEncontro] = useState<string>(nextMonthISO());
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        loadAll();
    }, []);

    const loadAll = async () => {
        setLoading(true);
        const [{ data: fbData, error: fbErr }, { data: memData }] = await Promise.all([
            supabase.rpc('list_feedbacks'),
            supabase.rpc('get_restaurant_members'),
        ]);
        if (fbErr) toast.error('Erro carregando fichas', { description: fbErr.message });
        setFeedbacks((fbData ?? []) as Feedback[]);
        setMembers((memData ?? []) as Membro[]);
        setLoading(false);
    };

    // ── Form helpers ──
    const resetForm = () => {
        setEditingId(null);
        setFuncionarioId('');
        setPeriodoInicio(lastMonthISO());
        setPeriodoFim(todayISO());
        setPontosPositivos('');
        setPontosMelhoria('');
        setPlanoAcao('');
        setProximoEncontro(nextMonthISO());
    };

    const openCreate = () => {
        resetForm();
        setView('form');
    };

    const openEdit = (fb: Feedback) => {
        setEditingId(fb.id);
        setFuncionarioId(fb.funcionario_id);
        setPeriodoInicio(fb.periodo_inicio);
        setPeriodoFim(fb.periodo_fim);
        setPontosPositivos(fb.pontos_positivos);
        setPontosMelhoria(fb.pontos_melhoria);
        setPlanoAcao(fb.plano_acao);
        setProximoEncontro(fb.proximo_encontro ?? '');
        setView('form');
    };

    const submitForm = async () => {
        if (!editingId && !funcionarioId) {
            toast.error('Escolhe o funcionário avaliado.');
            return;
        }
        if (!periodoInicio || !periodoFim) {
            toast.error('Defina o período avaliado.');
            return;
        }
        if (periodoFim < periodoInicio) {
            toast.error('A data final do período não pode ser antes da inicial.');
            return;
        }

        setSaving(true);
        const payload = {
            p_periodo_inicio: periodoInicio,
            p_periodo_fim: periodoFim,
            p_pontos_positivos: pontosPositivos.trim(),
            p_pontos_melhoria: pontosMelhoria.trim(),
            p_plano_acao: planoAcao.trim(),
            p_proximo_encontro: proximoEncontro || null,
        };

        const { error } = editingId
            ? await supabase.rpc('update_feedback', { p_id: editingId, ...payload })
            : await supabase.rpc('create_feedback', { p_funcionario_id: funcionarioId, ...payload });

        if (error) {
            toast.error('Não consegui salvar.', { description: error.message });
            setSaving(false);
            return;
        }

        toast.success(editingId ? 'Ficha atualizada.' : 'Ficha criada.');
        setSaving(false);
        resetForm();
        await loadAll();
        setView('list');
    };

    // ── Detail actions ──
    const acknowledge = async (fb: Feedback) => {
        const { error } = await supabase.rpc('acknowledge_feedback', { p_id: fb.id });
        if (error) {
            toast.error('Não consegui marcar como ciente.', { description: error.message });
            return;
        }
        toast.success('Ciência registrada.');
        await loadAll();
    };

    const remove = async (fb: Feedback) => {
        if (!confirm('Apagar essa ficha?')) return;
        const { error } = await supabase.rpc('delete_feedback', { p_id: fb.id });
        if (error) {
            toast.error('Não consegui deletar.', { description: error.message });
            return;
        }
        toast.success('Ficha apagada.');
        setActiveId(null);
        await loadAll();
        setView('list');
    };

    // ─── Render ──────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
            </div>
        );
    }

    // VIEW: form (criar/editar)
    if (view === 'form') {
        return (
            <FormView
                editingId={editingId}
                isDonoOrGerente={isDonoOrGerente}
                members={members}
                myUserId={user?.id}
                funcionarioId={funcionarioId}
                setFuncionarioId={setFuncionarioId}
                periodoInicio={periodoInicio}
                setPeriodoInicio={setPeriodoInicio}
                periodoFim={periodoFim}
                setPeriodoFim={setPeriodoFim}
                pontosPositivos={pontosPositivos}
                setPontosPositivos={setPontosPositivos}
                pontosMelhoria={pontosMelhoria}
                setPontosMelhoria={setPontosMelhoria}
                planoAcao={planoAcao}
                setPlanoAcao={setPlanoAcao}
                proximoEncontro={proximoEncontro}
                setProximoEncontro={setProximoEncontro}
                saving={saving}
                onCancel={() => { resetForm(); setView(activeId ? 'detail' : 'list'); }}
                onSubmit={submitForm}
            />
        );
    }

    // VIEW: detail
    if (view === 'detail' && active) {
        return (
            <DetailView
                fb={active}
                onBack={() => { setActiveId(null); setView('list'); }}
                onEdit={() => openEdit(active)}
                onDelete={() => remove(active)}
                onAck={() => acknowledge(active)}
            />
        );
    }

    // VIEW: list (default)
    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-ink">Feedbacks</h1>
                    <p className="text-warm-gray text-sm mt-0.5">
                        Fichas de feedback 1:1 — registro do que foi conversado e o plano daqui pra frente.
                    </p>
                </div>
                {isDonoOrGerente && (
                    <button
                        onClick={openCreate}
                        className="bg-primary-600 hover:bg-primary-700 text-white font-semibold px-4 py-2.5 rounded-xl shadow-sm flex items-center gap-2 self-start sm:self-auto"
                    >
                        <Plus className="w-4 h-4" />
                        Nova ficha
                    </button>
                )}
            </div>

            {feedbacks.length === 0 ? (
                <EmptyState
                    icon={MessageCircle}
                    title="Nenhuma ficha por aqui ainda"
                    description={
                        isDonoOrGerente
                            ? 'Crie a primeira ficha de feedback depois da próxima conversa 1:1.'
                            : 'Quando um gestor registrar um feedback seu, ele aparece aqui.'
                    }
                />
            ) : (
                <div className="space-y-3">
                    {feedbacks.map(fb => (
                        <FeedbackCard
                            key={fb.id}
                            fb={fb}
                            onClick={() => { setActiveId(fb.id); setView('detail'); }}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

// ─── Card de ficha (lista) ─────────────────────────────────────────────────
const FeedbackCard = ({ fb, onClick }: { fb: Feedback; onClick: () => void }) => {
    const acked = !!fb.acknowledged_at;
    return (
        <button
            onClick={onClick}
            className={`w-full text-left bg-white rounded-2xl border shadow-sm overflow-hidden transition-all hover:shadow-md ${
                acked ? 'border-success-200' : 'border-primary-200'
            }`}
        >
            <div className={`h-1 ${acked ? 'bg-success-500' : 'bg-primary-500'}`} />
            <div className="p-5">
                <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg shrink-0 ${
                        acked ? 'bg-success-100 text-success-700' : 'bg-primary-100 text-primary-700'
                    }`}>
                        {acked ? <ShieldCheck className="w-5 h-5" /> : <MessageCircle className="w-5 h-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <h3 className="font-bold text-ink truncate">{fb.funcionario_nome}</h3>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                acked
                                    ? 'bg-success-50 text-success-700'
                                    : 'bg-primary-50 text-primary-700'
                            }`}>
                                {acked ? 'Ciente' : 'Aguardando ciência'}
                            </span>
                        </div>
                        <p className="text-sm text-warm-gray mt-0.5 flex items-center gap-1.5">
                            <CalendarRange className="w-3.5 h-3.5" />
                            {fmtPeriodo(fb.periodo_inicio, fb.periodo_fim)}
                        </p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                            <span>Por {fb.autor_nome}</span>
                            {fb.proximo_encontro && (
                                <span className="flex items-center gap-1">
                                    <CalendarClock className="w-3 h-3" />
                                    Próx: {fmtDate(fb.proximo_encontro)}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </button>
    );
};

// ─── Tela de detalhe ──────────────────────────────────────────────────────
const DetailView = ({
    fb, onBack, onEdit, onDelete, onAck,
}: {
    fb: Feedback;
    onBack: () => void;
    onEdit: () => void;
    onDelete: () => void;
    onAck: () => void;
}) => {
    const acked = !!fb.acknowledged_at;
    const canEdit = fb.sou_autor && !acked;
    const canAck = fb.sou_funcionario && !acked;

    return (
        <div className="max-w-3xl mx-auto space-y-5">
            {/* Header */}
            <div className="flex items-center gap-3">
                <button
                    onClick={onBack}
                    className="p-2 rounded-lg hover:bg-slate-100 text-warm-gray hover:text-ink"
                    aria-label="Voltar"
                >
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex-1">
                    <h1 className="text-2xl font-bold text-ink">{fb.funcionario_nome}</h1>
                    <p className="text-warm-gray text-sm">
                        Ficha de feedback · por {fb.autor_nome}
                    </p>
                </div>
                {canEdit && (
                    <>
                        <button
                            onClick={onEdit}
                            className="p-2 rounded-lg hover:bg-slate-100 text-warm-gray hover:text-ink"
                            title="Editar"
                        >
                            <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                            onClick={onDelete}
                            className="p-2 rounded-lg hover:bg-red-50 text-warm-gray hover:text-red-600"
                            title="Apagar"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </>
                )}
            </div>

            {/* Status banner */}
            <div className={`rounded-xl border p-4 flex items-start gap-3 ${
                acked
                    ? 'bg-success-50 border-success-200 text-success-800'
                    : 'bg-primary-50 border-primary-200 text-primary-800'
            }`}>
                {acked ? <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" /> : <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />}
                <div className="text-sm">
                    {acked ? (
                        <>
                            <strong>Ciente.</strong>{' '}
                            {fb.funcionario_nome} confirmou em{' '}
                            {new Date(fb.acknowledged_at!).toLocaleDateString('pt-BR')} às{' '}
                            {new Date(fb.acknowledged_at!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.
                        </>
                    ) : (
                        <>
                            <strong>Aguardando ciência.</strong>{' '}
                            {fb.sou_funcionario
                                ? 'Quando você confirmar, a ficha fica registrada e não pode mais ser editada.'
                                : `Aguardando ${fb.funcionario_nome} marcar como ciente.`}
                        </>
                    )}
                </div>
            </div>

            {/* Período */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <div className="flex items-center gap-2 text-warm-gray text-sm font-semibold uppercase tracking-wide">
                    <CalendarRange className="w-4 h-4" />
                    Período avaliado
                </div>
                <p className="text-ink font-semibold mt-1.5 text-lg">
                    {fmtPeriodo(fb.periodo_inicio, fb.periodo_fim)}
                </p>
            </div>

            {/* Seções de conteúdo */}
            <Section
                Icon={Sparkles}
                tone="success"
                title="Pontos positivos"
                content={fb.pontos_positivos}
                placeholder="Nenhum elogio registrado."
            />
            <Section
                Icon={Target}
                tone="amber"
                title="Pontos de melhoria"
                content={fb.pontos_melhoria}
                placeholder="Nenhum ponto de melhoria registrado."
            />
            <Section
                Icon={ListChecks}
                tone="primary"
                title="Plano de ação"
                content={fb.plano_acao}
                placeholder="Nenhum plano de ação registrado."
            />

            {/* Próximo encontro */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <div className="flex items-center gap-2 text-warm-gray text-sm font-semibold uppercase tracking-wide">
                    <CalendarClock className="w-4 h-4" />
                    Próximo encontro
                </div>
                <p className="text-ink font-semibold mt-1.5 text-lg">
                    {fb.proximo_encontro ? fmtDate(fb.proximo_encontro) : 'Não agendado'}
                </p>
            </div>

            {/* Botão de ack */}
            {canAck && (
                <div className="sticky bottom-4 z-10">
                    <button
                        onClick={onAck}
                        className="w-full bg-success-600 hover:bg-success-700 text-white font-bold py-4 rounded-2xl shadow-lg flex items-center justify-center gap-2 text-lg"
                    >
                        <Check className="w-5 h-5" />
                        Marcar como ciente
                    </button>
                </div>
            )}
        </div>
    );
};

// ─── Seção de conteúdo (positivos, melhoria, plano) ──────────────────────
const Section = ({
    Icon, tone, title, content, placeholder,
}: {
    Icon: React.ElementType;
    tone: 'success' | 'amber' | 'primary';
    title: string;
    content: string;
    placeholder: string;
}) => {
    const toneClasses = {
        success: { iconBg: 'bg-success-100 text-success-700' },
        amber:   { iconBg: 'bg-amber-100 text-amber-700' },
        primary: { iconBg: 'bg-primary-100 text-primary-700' },
    }[tone];
    const isEmpty = !content.trim();

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center gap-2.5">
                <div className={`p-2 rounded-lg ${toneClasses.iconBg}`}>
                    <Icon className="w-4 h-4" />
                </div>
                <h2 className="font-bold text-ink">{title}</h2>
            </div>
            {isEmpty ? (
                <p className="text-sm text-slate-400 italic mt-3">{placeholder}</p>
            ) : (
                <p className="text-ink whitespace-pre-wrap mt-3 leading-relaxed">{content}</p>
            )}
        </div>
    );
};

// ─── Tela de criação/edição ──────────────────────────────────────────────
const FormView = ({
    editingId, isDonoOrGerente, members, myUserId,
    funcionarioId, setFuncionarioId,
    periodoInicio, setPeriodoInicio,
    periodoFim, setPeriodoFim,
    pontosPositivos, setPontosPositivos,
    pontosMelhoria, setPontosMelhoria,
    planoAcao, setPlanoAcao,
    proximoEncontro, setProximoEncontro,
    saving, onCancel, onSubmit,
}: {
    editingId: string | null;
    isDonoOrGerente: boolean;
    members: Membro[];
    myUserId: string | undefined;
    funcionarioId: string;
    setFuncionarioId: (v: string) => void;
    periodoInicio: string;
    setPeriodoInicio: (v: string) => void;
    periodoFim: string;
    setPeriodoFim: (v: string) => void;
    pontosPositivos: string;
    setPontosPositivos: (v: string) => void;
    pontosMelhoria: string;
    setPontosMelhoria: (v: string) => void;
    planoAcao: string;
    setPlanoAcao: (v: string) => void;
    proximoEncontro: string;
    setProximoEncontro: (v: string) => void;
    saving: boolean;
    onCancel: () => void;
    onSubmit: () => void;
}) => {
    if (!isDonoOrGerente) {
        return (
            <EmptyState
                icon={AlertCircle}
                title="Sem permissão"
                description="Apenas dono e gerente podem criar fichas de feedback."
            />
        );
    }

    return (
        <div className="max-w-3xl mx-auto space-y-5">
            <div className="flex items-center gap-3">
                <button
                    onClick={onCancel}
                    className="p-2 rounded-lg hover:bg-slate-100 text-warm-gray hover:text-ink"
                    aria-label="Cancelar"
                >
                    <X className="w-5 h-5" />
                </button>
                <div>
                    <h1 className="text-2xl font-bold text-ink">
                        {editingId ? 'Editar ficha' : 'Nova ficha de feedback'}
                    </h1>
                    <p className="text-warm-gray text-sm">
                        Registro de uma conversa 1:1 que aconteceu.
                    </p>
                </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
                {/* Funcionário (só na criação) */}
                {!editingId && (
                    <div>
                        <label className="block text-sm font-semibold text-ink mb-1.5">
                            Funcionário avaliado
                        </label>
                        <select
                            value={funcionarioId}
                            onChange={e => setFuncionarioId(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white"
                        >
                            <option value="">— Escolha quem foi avaliado —</option>
                            {members.map(m => (
                                <option key={m.usuario_id} value={m.usuario_id}>
                                    {m.nome} ({m.perfil}){m.usuario_id === myUserId ? ' · você' : ''}
                                </option>
                            ))}
                        </select>
                        <p className="text-xs text-warm-gray mt-1">
                            Pode escolher você mesmo — é normal registrar auto-feedbacks.
                        </p>
                    </div>
                )}

                {/* Período */}
                <div>
                    <label className="block text-sm font-semibold text-ink mb-1.5">
                        Período avaliado
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <p className="text-xs text-warm-gray mb-1">Início</p>
                            <input
                                type="date"
                                value={periodoInicio}
                                onChange={e => setPeriodoInicio(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                            />
                        </div>
                        <div>
                            <p className="text-xs text-warm-gray mb-1">Fim</p>
                            <input
                                type="date"
                                value={periodoFim}
                                onChange={e => setPeriodoFim(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                            />
                        </div>
                    </div>
                </div>

                {/* Pontos positivos */}
                <FormTextarea
                    Icon={Sparkles}
                    label="Pontos positivos (elogios)"
                    placeholder="O que foi bem feito? O que merece reconhecimento?"
                    value={pontosPositivos}
                    onChange={setPontosPositivos}
                />

                {/* Pontos de melhoria */}
                <FormTextarea
                    Icon={Target}
                    label="Pontos de melhoria"
                    placeholder="O que precisa evoluir? Seja direto e construtivo."
                    value={pontosMelhoria}
                    onChange={setPontosMelhoria}
                />

                {/* Plano de ação */}
                <FormTextarea
                    Icon={ListChecks}
                    label="Plano de ação de melhoria"
                    placeholder="Quais ações concretas vocês combinaram?"
                    value={planoAcao}
                    onChange={setPlanoAcao}
                />

                {/* Próximo encontro */}
                <div>
                    <label className="block text-sm font-semibold text-ink mb-1.5 flex items-center gap-1.5">
                        <CalendarClock className="w-4 h-4 text-warm-gray" />
                        Próximo encontro
                    </label>
                    <input
                        type="date"
                        value={proximoEncontro}
                        onChange={e => setProximoEncontro(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                    />
                    <p className="text-xs text-warm-gray mt-1">Opcional — deixe em branco se não tiver definido.</p>
                </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2">
                <button
                    onClick={onCancel}
                    className="px-4 py-2 text-warm-gray hover:text-ink font-medium"
                >
                    Cancelar
                </button>
                <button
                    onClick={onSubmit}
                    disabled={saving}
                    className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-xl flex items-center gap-2"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {editingId ? 'Salvar alterações' : 'Criar ficha'}
                </button>
            </div>
        </div>
    );
};

const FormTextarea = ({
    Icon, label, placeholder, value, onChange,
}: {
    Icon: React.ElementType;
    label: string;
    placeholder: string;
    value: string;
    onChange: (v: string) => void;
}) => (
    <div>
        <label className="block text-sm font-semibold text-ink mb-1.5 flex items-center gap-1.5">
            <Icon className="w-4 h-4 text-warm-gray" />
            {label}
        </label>
        <textarea
            value={value}
            onChange={e => onChange(e.target.value)}
            rows={4}
            placeholder={placeholder}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none"
        />
    </div>
);

const EmptyState = ({
    icon: Icon, title, description,
}: { icon: React.ElementType; title: string; description: string }) => (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center">
        <Icon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <p className="font-semibold text-ink">{title}</p>
        <p className="text-sm text-warm-gray mt-1">{description}</p>
    </div>
);
