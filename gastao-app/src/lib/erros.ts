// Tradução central de erros para mensagens amigáveis em PT-BR.
// Cobre erros de auth do Supabase, códigos SQLSTATE do Postgres (constraints)
// e as RAISE EXCEPTION das nossas RPCs. Uso:
//   toast.error(traduzErro(error));
//   setError(traduzErro(error));
// Nunca joga texto técnico cru (constraint, coluna, inglês) na cara do usuário.

type ErroLike =
    | string
    | { message?: string; code?: string; details?: string; hint?: string }
    | null
    | undefined;

const extrai = (err: ErroLike): { msg: string; code: string } => {
    if (err == null) return { msg: '', code: '' };
    if (typeof err === 'string') return { msg: err, code: '' };
    return { msg: err.message ?? '', code: err.code ?? '' };
};

export const traduzErro = (err: ErroLike): string => {
    const { msg, code } = extrai(err);
    const m = msg.toLowerCase();

    // ── Auth (Supabase) ────────────────────────────────────────────────
    if (m.includes('invalid login credentials')) return 'Email ou senha inválidos.';
    if (m.includes('email not confirmed')) return 'Email não confirmado. Verifique sua caixa de entrada.';
    if (m.includes('too many requests') || m.includes('rate limit')) return 'Muitas tentativas. Aguarde alguns minutos.';
    if (m.includes('user already registered') || m.includes('already been registered')) return 'Esse email já tem cadastro. Faça login.';
    if (m.includes('password should be at least')) return 'A senha precisa ter pelo menos 6 caracteres.';
    if (m.includes('user not found')) return 'Usuário não encontrado.';
    if (m.includes('invalid email')) return 'Email inválido.';
    if (m.includes('token has expired') || m.includes('invalid token')) return 'O link expirou. Peça um novo.';

    // ── Postgres — códigos SQLSTATE (mais confiável que o texto) ────────
    if (code === '23505' || m.includes('duplicate key')) return 'Esse registro já existe.';
    if (code === '23503' || m.includes('violates foreign key')) return 'Este item está sendo usado em outro lugar e não pode ser removido. Remova as referências antes.';
    if (code === '23514' || m.includes('violates check constraint')) return 'Algum valor informado é inválido. Confira os campos.';
    if (code === '23502' || m.includes('null value')) return 'Preencha todos os campos obrigatórios.';
    if (code === '42501' || m.includes('permission') || m.includes('sem permissão')) return 'Você não tem permissão para esta ação.';

    // ── RAISE EXCEPTION das nossas RPCs (já em PT-BR) ───────────────────
    // Mensagens que já escrevemos amigáveis passam direto.
    if (msg && /[áàâãéêíóôõúç]/i.test(msg) && msg.length < 160 && !m.includes('error')) {
        return msg;
    }

    // ── Rede ────────────────────────────────────────────────────────────
    if (m.includes('failed to fetch') || m.includes('network')) return 'Falha de conexão. Verifique sua internet e tente de novo.';

    return 'Ocorreu um erro. Tente novamente.';
};
