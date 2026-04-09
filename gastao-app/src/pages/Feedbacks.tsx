import React, { useEffect, useState } from 'react';
import {
    MessageCircle, Plus, Loader2, X, ThumbsUp, Info, AlertTriangle,
    Eye, EyeOff, Send, Check,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { toast } from 'sonner';

type Tipo = 'elogio' | 'orientacao' | 'alerta';

interface Inbox {
    id: string;
    tipo: Tipo;
    titulo: string;
    mensagem: string;
    criado_em: string;
    autor_nome: string;
    lido: boolean;
}

interface Sent {
    id: string;
    tipo: Tipo;
    titulo: string;
    mensagem: string;
    criado_em: string;
    total_recipients: number;
    total_reads: number;
}

interface Membro {
    id: string;
    usuario_id: string;
    nome: string;
    email: string;
    perfil: string;
}

const TIPO_CONFIG: Record<Tipo, {
    label: string;
    Icon: React.ElementType;
    badgeClass: string;
    borderClass: string;
}> = {
    elogio:     { label: 'Elogio',     Icon: ThumbsUp,      badgeClass: 'bg-success-100 text-success-700', borderClass: 'bg-success-500' },
    orientacao: { label: 'Orientação', Icon: Info,          badgeClass: 'bg-primary-100 text-primary-700', borderClass: 'bg-primary-500' },
    alerta:     { label: 'Alerta',     Icon: AlertTriangle, badgeClass: 'bg-red-100 text-red-700',         borderClass: 'bg-red-500' },
};

const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) +
        ' · ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

export const Feedbacks = () => {
    const { user } = useAuth();
    const { isDonoOrGerente } = usePermissions();

    const [tab, setTab] = useState<'inbox' | 'sent'>('inbox');
    const [inbox, setInbox] = useState<Inbox[]>([]);
    const [sent, setSent] = useState<Sent[]>([]);
    const [loading, setLoading] = useState(true);

    // Modal: enviar feedback
    const [showCreate, setShowCreate] = useState(false);
    const [members, setMembers] = useState<Membro[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [newTipo, setNewTipo] = useState<Tipo>('orientacao');
    const [newTitulo, setNewTitulo] = useState('');
    const [newMensagem, setNewMensagem] = useState('');
    const [sending, setSending] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        const [inboxRes, sentRes] = await Promise.all([
            supabase.rpc('get_my_feedbacks'),
            isDonoOrGerente ? supabase.rpc('get_sent_feedbacks') : Promise.resolve({ data: [] }),
        ]);
        setInbox((inboxRes.data ?? []) as Inbox[]);
        setSent((sentRes.data ?? []) as Sent[]);
        setLoading(false);
    };

    const openFeedback = async (fb: Inbox) => {
        if (!fb.lido) {
            await supabase.rpc('mark_feedback_read', { p_feedback_id: fb.id });
            setInbox(prev => prev.map(i => i.id === fb.id ? { ...i, lido: true } : i));
        }
    };

    const openCreateModal = async () => {
        setShowCreate(true);
        if (members.length === 0) {
            const { data } = await supabase.rpc('get_restaurant_members');
            const list = ((data ?? []) as Membro[]).filter(m => m.usuario_id !== user?.id);
            setMembers(list);
        }
    };

    const toggleRecipient = (id: string) => {
        const copy = new Set(selectedIds);
        if (copy.has(id)) copy.delete(id);
        else copy.add(id);
        setSelectedIds(copy);
    };

    const selectAllRecipients = () => {
        setSelectedIds(new Set(members.map(m => m.usuario_id)));
    };

    const sendFeedback = async () => {
        if (!newTitulo.trim() || !newMensagem.trim()) {
            toast.error('Preenche título e mensagem.');
            return;
        }
        if (selectedIds.size === 0) {
            toast.error('Escolhe pelo menos uma pessoa.');
            return;
        }

        setSending(true);
        const { error } = await supabase.rpc('send_feedback', {
            p_tipo: newTipo,
            p_titulo: newTitulo.trim(),
            p_mensagem: newMensagem.trim(),
            p_recipients: Array.from(selectedIds),
        });

        if (error) {
            toast.error('Não consegui enviar.', { description: error.message });
            setSending(false);
            return;
        }

        toast.success('Feedback enviado.');
        setShowCreate(false);
        setNewTitulo('');
        setNewMensagem('');
        setNewTipo('orientacao');
        setSelectedIds(new Set());
        setSending(false);
        loadData();
    };

    const unreadCount = inbox.filter(i => !i.lido).length;

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-ink">Feedbacks</h1>
                    <p className="text-warm-gray text-sm mt-0.5">
                        Alinhamento direto com o time — sem grupo de WhatsApp bagunçado.
                    </p>
                </div>
                {isDonoOrGerente && (
                    <button
                        onClick={openCreateModal}
                        className="bg-primary-600 hover:bg-primary-700 text-white font-semibold px-4 py-2.5 rounded-xl shadow-sm flex items-center gap-2 self-start sm:self-auto"
                    >
                        <Plus className="w-4 h-4" />
                        Enviar feedback
                    </button>
                )}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-sm w-fit">
                <button
                    onClick={() => setTab('inbox')}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
                        tab === 'inbox' ? 'bg-primary-50 text-primary-700' : 'text-warm-gray hover:text-ink'
                    }`}
                >
                    Recebidos
                    {unreadCount > 0 && (
                        <span className="bg-primary-600 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                            {unreadCount}
                        </span>
                    )}
                </button>
                {isDonoOrGerente && (
                    <button
                        onClick={() => setTab('sent')}
                        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                            tab === 'sent' ? 'bg-primary-50 text-primary-700' : 'text-warm-gray hover:text-ink'
                        }`}
                    >
                        Enviados
                    </button>
                )}
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
                </div>
            ) : tab === 'inbox' ? (
                inbox.length === 0 ? (
                    <EmptyState
                        icon={MessageCircle}
                        title="Nenhum feedback por aqui"
                        description="Quando o dono ou gerente enviar algo pra você, aparece aqui."
                    />
                ) : (
                    <div className="space-y-3">
                        {inbox.map(fb => {
                            const cfg = TIPO_CONFIG[fb.tipo];
                            const Icon = cfg.Icon;
                            return (
                                <div
                                    key={fb.id}
                                    onClick={() => openFeedback(fb)}
                                    className={`bg-white rounded-2xl border shadow-sm overflow-hidden cursor-pointer transition-all hover:shadow-md ${
                                        fb.lido ? 'border-slate-200' : 'border-primary-300'
                                    }`}
                                >
                                    <div className={`h-1 ${cfg.borderClass}`} />
                                    <div className="p-5">
                                        <div className="flex items-start gap-3">
                                            <div className={`p-2 rounded-lg ${cfg.badgeClass} shrink-0`}>
                                                <Icon className="w-4 h-4" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between gap-2">
                                                    <h3 className={`font-bold text-ink ${!fb.lido ? 'text-primary-700' : ''}`}>
                                                        {fb.titulo}
                                                    </h3>
                                                    {!fb.lido && (
                                                        <span className="w-2 h-2 bg-primary-500 rounded-full shrink-0" />
                                                    )}
                                                </div>
                                                <p className="text-sm text-warm-gray mt-1 whitespace-pre-wrap">{fb.mensagem}</p>
                                                <p className="text-xs text-slate-400 mt-3">
                                                    De {fb.autor_nome} · {fmtDate(fb.criado_em)}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )
            ) : (
                // SENT
                sent.length === 0 ? (
                    <EmptyState
                        icon={Send}
                        title="Você ainda não enviou feedbacks"
                        description="Elogie, oriente ou alerte o time. A gente guarda o histórico."
                    />
                ) : (
                    <div className="space-y-3">
                        {sent.map(fb => {
                            const cfg = TIPO_CONFIG[fb.tipo];
                            const Icon = cfg.Icon;
                            const allRead = fb.total_reads === fb.total_recipients;
                            return (
                                <div key={fb.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                    <div className={`h-1 ${cfg.borderClass}`} />
                                    <div className="p-5">
                                        <div className="flex items-start gap-3">
                                            <div className={`p-2 rounded-lg ${cfg.badgeClass} shrink-0`}>
                                                <Icon className="w-4 h-4" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h3 className="font-bold text-ink">{fb.titulo}</h3>
                                                <p className="text-sm text-warm-gray mt-1 whitespace-pre-wrap">{fb.mensagem}</p>
                                                <div className="flex items-center gap-4 mt-3 text-xs">
                                                    <span className="text-slate-400">{fmtDate(fb.criado_em)}</span>
                                                    <span className={`flex items-center gap-1 font-medium ${allRead ? 'text-success-600' : 'text-warm-gray'}`}>
                                                        {allRead ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                                                        {fb.total_reads}/{fb.total_recipients} leram
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )
            )}

            {/* Modal: enviar */}
            {showCreate && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col">
                        <div className="flex items-center justify-between p-5 border-b border-slate-100">
                            <h2 className="font-bold text-lg text-ink">Enviar feedback</h2>
                            <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-slate-600 p-1">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-5 space-y-4 overflow-y-auto">
                            <div>
                                <label className="block text-sm font-semibold text-ink mb-2">Tipo</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {(['elogio', 'orientacao', 'alerta'] as Tipo[]).map(t => {
                                        const cfg = TIPO_CONFIG[t];
                                        const Icon = cfg.Icon;
                                        const active = newTipo === t;
                                        return (
                                            <button
                                                key={t}
                                                type="button"
                                                onClick={() => setNewTipo(t)}
                                                className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                                                    active
                                                        ? 'bg-primary-600 text-white'
                                                        : 'bg-slate-100 text-warm-gray hover:bg-slate-200'
                                                }`}
                                            >
                                                <Icon className="w-4 h-4" />
                                                {cfg.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-ink mb-1">Título</label>
                                <input
                                    type="text"
                                    value={newTitulo}
                                    onChange={e => setNewTitulo(e.target.value)}
                                    placeholder="Resumo curto"
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-ink mb-1">Mensagem</label>
                                <textarea
                                    value={newMensagem}
                                    onChange={e => setNewMensagem(e.target.value)}
                                    rows={4}
                                    placeholder="Fala o que precisa ser falado."
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none"
                                />
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="block text-sm font-semibold text-ink">Destinatários</label>
                                    <button
                                        type="button"
                                        onClick={selectAllRecipients}
                                        className="text-xs text-primary-600 font-semibold hover:text-primary-700"
                                    >
                                        Selecionar todos
                                    </button>
                                </div>
                                {members.length === 0 ? (
                                    <p className="text-sm text-warm-gray">Nenhum outro membro no restaurante ainda.</p>
                                ) : (
                                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                        {members.map(m => {
                                            const selected = selectedIds.has(m.usuario_id);
                                            return (
                                                <button
                                                    key={m.id}
                                                    type="button"
                                                    onClick={() => toggleRecipient(m.usuario_id)}
                                                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${
                                                        selected
                                                            ? 'bg-primary-50 border-primary-300'
                                                            : 'bg-white border-slate-200 hover:bg-slate-50'
                                                    }`}
                                                >
                                                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${
                                                        selected ? 'bg-primary-600 border-primary-600' : 'border-slate-300'
                                                    }`}>
                                                        {selected && <Check className="w-3 h-3 text-white" />}
                                                    </div>
                                                    <div className="min-w-0 flex-1 text-left">
                                                        <p className="text-sm font-medium text-ink truncate">{m.nome}</p>
                                                        <p className="text-xs text-warm-gray truncate">{m.email}</p>
                                                    </div>
                                                    <span className="text-xs text-slate-400 capitalize">{m.perfil}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
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
                                onClick={sendFeedback}
                                disabled={sending}
                                className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg flex items-center gap-2"
                            >
                                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                Enviar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const EmptyState = ({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) => (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center">
        <Icon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <p className="font-semibold text-ink">{title}</p>
        <p className="text-sm text-warm-gray mt-1">{description}</p>
    </div>
);
