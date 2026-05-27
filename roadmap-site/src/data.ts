export type Status = 'done' | 'in_progress' | 'next' | 'backlog' | 'future';

export interface Item {
  text: string;
  done: boolean;
  date?: string;        // YYYY-MM-DD em que ficou pronto
  inProgress?: boolean; // marca explícita
}

export interface Milestone {
  id: number;
  name: string;
  subtitle: string;
  status: Status;
  items: Item[];
  estimatedHours: string;  // ex: "10-14h"
  actualHours?: string;    // ex: "~25h"
  calendarWindow?: string; // ex: "2026-04-08 → 2026-05-15"
  notes?: string;
}

export const lastUpdated = '2026-05-26';

export const milestones: Milestone[] = [
  {
    id: 1,
    name: 'Validação inicial (BRUT)',
    subtitle: 'Primeiro cliente real com demo executada',
    status: 'done',
    estimatedHours: '~25h',
    actualHours: '~25h',
    calendarWindow: '2026-04-08 → 2026-05-15',
    items: [
      { text: 'Fork TOCS → Gastão (rebranding, paleta, tom de voz)', done: true, date: '2026-04-08' },
      { text: 'Conversor BRUT (3 abas → planilha-mãe v2)', done: true, date: '2026-05-13' },
      { text: 'Tenant BRUT: 419 insumos / 17 preparos / 21 fichas', done: true, date: '2026-05-13' },
      { text: 'Vendas abril/2026 inseridas — R$ 58k, 14 fichas', done: true, date: '2026-05-14' },
      { text: '6 fichas-âncora com CMV calculado', done: true, date: '2026-05-14' },
      { text: 'Roteiro demo escrito (duplo registro Vanessa/Dani)', done: true, date: '2026-05-14' },
      { text: 'Bugs do app corrigidos (cache, cascata, multi-cat, fmtMoney)', done: true, date: '2026-05-14' },
      { text: 'Planilha-mãe v3 chef-friendly (10 abas + validação)', done: true, date: '2026-05-15' },
      { text: 'Demo BRUT executada', done: true, date: '2026-05-15' },
    ],
  },
  {
    id: 2,
    name: 'Segundo cliente (CRIMINAL)',
    subtitle: 'Provar escalabilidade — replicar BRUT em outro cliente do BPO',
    status: 'done',
    estimatedHours: '~10h',
    actualHours: '~10h',
    calendarWindow: '2026-05-19 → 2026-05-20',
    items: [
      { text: 'Planilhas CRIMINAL diagnosticadas (75 abas, formato auto-contido)', done: true, date: '2026-05-19' },
      { text: 'Conversor CRIMINAL escrito (convert-criminal.mjs)', done: true, date: '2026-05-19' },
      { text: 'Bugs do conversor: auto-ref, unidade canônica, ficha→ficha', done: true, date: '2026-05-19' },
      { text: 'Tenant CRIMINAL: 145 insumos / 16 preparos / 48 fichas / 299 composições', done: true, date: '2026-05-20' },
      { text: '17 fichas precificadas via cardápio PDF parseado', done: true, date: '2026-05-20' },
      { text: 'Vendas maio: 3.277 transações → 250 linhas — R$ 108.372', done: true, date: '2026-05-20' },
      { text: 'Conversation point detectado (Batata CMV 80%)', done: true, date: '2026-05-20' },
      { text: 'Smoke test passado', done: true, date: '2026-05-20' },
      { text: 'Demo CRIMINAL executada', done: true, date: '2026-05-20' },
    ],
  },
  {
    id: 3,
    name: 'NFe Bulk (Cinco operando)',
    subtitle: 'Cinco BPO sobe múltiplos XMLs de uma vez + matching IA com cálculo de embalagem',
    status: 'in_progress',
    estimatedHours: '5-6h',
    items: [
      { text: 'Componente BulkUploadView (multi-file + drag pasta)', done: false, inProgress: true },
      { text: 'Loop sequencial com progress visual', done: false },
      { text: 'Skip soft de duplicatas (numero + cnpj + data)', done: false },
      { text: 'Log final agregado: X processados / Y duplicados / Z erros', done: false },
      { text: 'Migrar match-nfe-items de OpenAI gpt-4o-mini → Claude (Haiku/Sonnet)', done: false },
      { text: 'Extração de embalagem + qty canônica (10 PCT × 1kg = 10kg)', done: false },
      { text: 'Cache local de mapeamentos (fornecedor + descrição → insumo)', done: false },
      { text: 'Atualização de avg_cost_per_unit pelo último/médio preço', done: false },
      { text: 'Teste end-to-end com 5-10 XMLs reais', done: false },
    ],
  },
  {
    id: 4,
    name: 'B2B2B real (painel Cinco)',
    subtitle: 'Cinco entra e vê N restaurantes num lugar só com isolamento absoluto',
    status: 'next',
    estimatedHours: '6-9h',
    items: [
      { text: 'Perfil novo `bpo` em membros.perfil (N memberships)', done: false },
      { text: 'Header global com dropdown "Restaurante ativo"', done: false },
      { text: 'RLS auditada — bpo nunca bypassa policies cross-tenant', done: false },
      { text: 'White-label leve (logo + cor por BPO)', done: false },
      { text: 'Onboarding assistido — Cinco sobe planilha-mãe + valida em 1 clique', done: false },
    ],
    notes: 'Bloqueador de escala — sem isso, Cinco opera N tenants logando em N contas.',
  },
  {
    id: 5,
    name: 'Robustez técnica',
    subtitle: 'Blindagens que evitam regressão e melhoram UX',
    status: 'backlog',
    estimatedHours: '4-6h',
    items: [
      { text: 'Importador atômico — RPC BEGIN/COMMIT com rollback automático', done: false },
      { text: 'React Query — cache invalidation entre rotas (resolve "pisca em branco")', done: false },
      { text: 'Alertas de CMV alto configurável por restaurante', done: false },
      { text: 'Adaptar ExcelImporter pra schema v3 (embalagem qtd + unidade)', done: false },
      { text: 'Refactor gastaoTemplate.ts — parser por header name vs posição', done: false },
    ],
  },
  {
    id: 6,
    name: 'NFe automática SEFAZ',
    subtitle: 'NFe chega no Gastão sem ninguém precisar subir XML',
    status: 'future',
    estimatedHours: '4-6h',
    items: [
      { text: 'Avaliar provider (Arquivei vs FocusNFe — custo/cobertura)', done: false },
      { text: 'Job agendado puxando NFe novas por CNPJ', done: false },
      { text: 'Cron + dedup automático', done: false },
      { text: 'UI de "configurar provider" no painel BPO', done: false },
    ],
    notes: 'Diferenciação real vs Saipos — argumento forte no pitch comercial.',
  },
  {
    id: 7,
    name: 'Estoque de produção',
    subtitle: 'Chef registra "produzi 20kg de Aligot" → sistema deduz insumos + adiciona ao estoque do preparo',
    status: 'future',
    estimatedHours: '10-14h',
    items: [
      { text: 'Migration 017: stock_movements + productions + view current_stock', done: false },
      { text: 'RPC register_production com cascata só na produção', done: false },
      { text: 'RPC register_sale deduz só componentes diretos (sem cascata)', done: false },
      { text: 'UI em /preparos — bloco de estoque + modal "Registrar produção"', done: false },
      { text: 'Dashboard widget "Estoque baixo"', done: false },
    ],
    notes: 'Feature âncora — Saipos/Konclui não fazem isso direito pra sub-receitas.',
  },
];

export const closedDecisions = [
  'B2B2B via BPO Cinco (não vai pra B2C self-service)',
  'Unidades canônicas g/ml/un (não kg/L)',
  'Stock-of-production: cascata só na produção, não na venda',
  'Template v3 mantém v2 ativo durante transição',
  'Pricing público fora da presença do cliente final',
  'Cinco vê N restaurantes via switch de contexto, RLS nunca bypassada',
];
