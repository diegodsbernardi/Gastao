import React, { createContext, useCallback, useContext, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

// Substitui os confirm()/prompt() nativos do browser (feios, fora da identidade
// visual e bloqueados em vários webviews — WhatsApp/Instagram in-app) por um
// modal próprio. API imperativa baseada em promise pra troca mínima:
//   const { confirm } = useConfirm();
//   if (!(await confirm({ title, message, tone: 'danger' }))) return;
//   const nome = await promptDialog({ title, message, defaultValue });

interface ConfirmOpts {
    title: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    tone?: 'default' | 'danger';
}
interface PromptOpts {
    title: string;
    message?: string;
    defaultValue?: string;
    placeholder?: string;
    confirmText?: string;
    cancelText?: string;
    tone?: 'default' | 'danger';
}

type Pending =
    | { kind: 'confirm'; opts: ConfirmOpts; resolve: (v: boolean) => void }
    | { kind: 'prompt'; opts: PromptOpts; resolve: (v: string | null) => void };

interface ConfirmCtx {
    confirm: (opts: ConfirmOpts) => Promise<boolean>;
    promptDialog: (opts: PromptOpts) => Promise<string | null>;
}

const Ctx = createContext<ConfirmCtx | null>(null);

export const useConfirm = (): ConfirmCtx => {
    const c = useContext(Ctx);
    if (!c) throw new Error('useConfirm precisa estar dentro de <ConfirmProvider>');
    return c;
};

export const ConfirmProvider = ({ children }: { children: React.ReactNode }) => {
    const [pending, setPending] = useState<Pending | null>(null);
    const [inputValue, setInputValue] = useState('');

    const confirm = useCallback((opts: ConfirmOpts) =>
        new Promise<boolean>(resolve => setPending({ kind: 'confirm', opts, resolve })), []);

    const promptDialog = useCallback((opts: PromptOpts) =>
        new Promise<string | null>(resolve => {
            setInputValue(opts.defaultValue ?? '');
            setPending({ kind: 'prompt', opts, resolve });
        }), []);

    const close = (result: boolean | string | null) => {
        if (!pending) return;
        if (pending.kind === 'confirm') (pending.resolve as (v: boolean) => void)(result as boolean);
        else (pending.resolve as (v: string | null) => void)(result as string | null);
        setPending(null);
    };

    const isDanger = pending?.opts.tone === 'danger';

    return (
        <Ctx.Provider value={{ confirm, promptDialog }}>
            {children}
            {pending && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
                    onClick={() => close(pending.kind === 'confirm' ? false : null)}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-start gap-3">
                            {isDanger && (
                                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                                    <AlertTriangle className="w-5 h-5 text-red-600" />
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <h3 className="text-base font-bold text-slate-900">{pending.opts.title}</h3>
                                {pending.opts.message && (
                                    <p className="mt-1 text-sm text-slate-500">{pending.opts.message}</p>
                                )}
                            </div>
                        </div>

                        {pending.kind === 'prompt' && (
                            <input
                                autoFocus
                                value={inputValue}
                                onChange={e => setInputValue(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') close(inputValue.trim() || null); }}
                                placeholder={pending.opts.placeholder}
                                className="mt-4 w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none text-sm"
                            />
                        )}

                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                onClick={() => close(pending.kind === 'confirm' ? false : null)}
                                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                {pending.opts.cancelText ?? 'Cancelar'}
                            </button>
                            <button
                                autoFocus={pending.kind === 'confirm'}
                                onClick={() => close(pending.kind === 'confirm' ? true : (inputValue.trim() || null))}
                                className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
                                    isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-600 hover:bg-primary-700'
                                }`}
                            >
                                {pending.opts.confirmText ?? (isDanger ? 'Excluir' : 'Confirmar')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </Ctx.Provider>
    );
};
