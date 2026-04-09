/**
 * Gastão — Design Tokens
 *
 * Fonte: Manual de Identidade Visual (Bibliografia/).
 * Qualquer mudança de paleta, tipografia ou tom passa por aqui primeiro.
 *
 * Regra de ouro: se você está prestes a usar uma cor hex literal dentro de
 * um componente, pare e veja se ela mora neste arquivo. Se não mora, adicione.
 */

// ─────────────────────────────────────────────────────────────────────
// Paleta oficial (nomes do manual)
// ─────────────────────────────────────────────────────────────────────

/** Cor-mãe da marca — energia, gastronomia, ação */
export const ORANGE = '#FF6B35' as const;

/** Cor de resultado positivo — lucro, controle, meta batida */
export const GREEN = '#4CAF50' as const;

/** Secundária quente — usada com moderação em acentos */
export const BEIGE = '#D4A574' as const;

/** Cinza neutro profissional */
export const WARM_GRAY = '#6B6B6B' as const;

/** Texto principal e alta hierarquia */
export const DARK_GRAY = '#2C2C2C' as const;

/** Background tipo papel natural (NÃO usar branco puro fora de cards) */
export const CREAM = '#FAF6EE' as const;

// ─────────────────────────────────────────────────────────────────────
// Escala derivada do laranja (para gradientes, hovers, fundos sutis)
// Valores calculados manualmente a partir de #FF6B35
// ─────────────────────────────────────────────────────────────────────

export const PRIMARY_SCALE = {
    50:  '#FFF4EE',
    100: '#FFE2D1',
    200: '#FFC09B',
    300: '#FF9D65',
    400: '#FF854A',
    500: '#FF6B35', // Orange oficial
    600: '#E55A20',
    700: '#BF4A1A',
    800: '#8F3712',
    900: '#66260A',
} as const;

export const SUCCESS_SCALE = {
    50:  '#E8F5E9',
    100: '#C8E6C9',
    500: '#4CAF50', // Green oficial
    600: '#43A047',
    700: '#388E3C',
} as const;

// ─────────────────────────────────────────────────────────────────────
// Tipografia
// ─────────────────────────────────────────────────────────────────────

export const FONT_FAMILY = {
    /** Títulos — manual pede Ytre Bold, fallback Poppins Bold */
    display: "'Ytre', 'Poppins', system-ui, -apple-system, sans-serif",
    /** Corpo e UI */
    sans: "'Poppins', system-ui, -apple-system, sans-serif",
} as const;

// ─────────────────────────────────────────────────────────────────────
// Tom de voz (para copy do app, mensagens de erro, alertas)
// As 4 características oficiais: prático, inteligente, calmo, confiável.
// Exemplos canônicos do manual:
//   "Seu CMV subiu essa semana. Vamos ajustar isso juntos."
//   "Ótimo! Você economizou R$ 2.400 este mês."
//   "Parabéns! Meta batida."
//   "Você está perdendo margem aqui."
//   "Alerta: desperdício acima da média."
// ─────────────────────────────────────────────────────────────────────

export const VOICE_TRAITS = ['prático', 'inteligente', 'calmo', 'confiável'] as const;
export type VoiceTrait = typeof VOICE_TRAITS[number];
