# Gastão

**Inteligência operacional para restaurantes.**

Gastão é uma plataforma SaaS focada em ajudar donos e gerentes de pequenos e médios restaurantes a controlar a operação do dia-a-dia: CMV, fichas técnicas, estoque via nota fiscal, checklists de rotina e feedbacks para a equipe — tudo direto do celular.

---

## Stack

- **Frontend:** React 19 + TypeScript + Vite 8 + Tailwind CSS 4 + React Router 7
- **Backend:** Supabase (Postgres + Auth + Row Level Security + Edge Functions)
- **Parser NFe:** Edge Function em Deno (`parse-nfe`)
- **Notificações UI:** Sonner

---

## Rodando localmente

### 1. Dependências

```bash
cd gastao-app
npm install
```

### 2. Variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha com as credenciais do seu projeto Supabase:

```bash
cp .env.example .env.local
```

```
VITE_SUPABASE_URL=https://<seu-projeto>.supabase.co
VITE_SUPABASE_ANON_KEY=<sua-anon-key>
```

> **Ainda não criou o projeto Supabase?** Crie um novo projeto em [supabase.com](https://supabase.com/dashboard) (plano free serve pra desenvolvimento), e depois rode as migrations na ordem — veja abaixo.

### 3. Migrations do banco

Entre no **SQL Editor** do Supabase dashboard e execute os arquivos em `supabase/migrations/` **na ordem numérica**:

| # | Arquivo | O que faz |
|---|---------|-----------|
| 000 | `000_setup.sql` *(não incluso — veja nota)* | Tabelas base: `restaurantes`, `profiles`, `membros`, helper `get_my_restaurant_id()` |
| 001 | `001_equipe.sql` | Convites, `get_my_membership`, `create_restaurant`, `accept_invite`, `get_restaurant_members` |
| 002 | `002_ingredient_use_in_recipes.sql` | Função auxiliar do módulo de insumos |
| 003 | `003_nfe.sql` | Tabelas de NFe e matching de itens |
| 004 | `004_three_layer_schema.sql` | Schema de receitas em 3 camadas: insumos → preparos → fichas finais |
| 005 | `005_fix_missing_columns.sql` | Ajustes de schema |
| 006 | `006_fix_ingredients_columns.sql` | Ajustes em ingredients |
| 007 | `007_fix_rls_policies.sql` | Correções de RLS |
| 008 | `008_add_unit_type_to_recipes.sql` | Tipo de unidade para conversões |
| 009 | `009_fix_user_trigger.sql` | Trigger que popula `profiles` no signup |
| 010 | `010_checklists.sql` | **NOVO** — Checklists operacionais (templates, runs, RPCs) |
| 011 | `011_feedbacks.sql` | **NOVO** — Feedbacks do dono/gerente para o time |

> **Nota sobre 000:** a migration zero (setup base de `restaurantes`, `profiles`, `membros` e o helper `get_my_restaurant_id()`) veio do ambiente anterior (TOCS) e não foi extraída como arquivo ainda. Antes de rodar 001, garanta que essas tabelas e o helper existem no seu projeto — se for começar do zero, precisará criá-las primeiro. Uma tarefa de seguimento é gerar essa migration inicial a partir do schema atual.

### 4. Edge Functions (opcional — necessário para NFe)

```bash
supabase functions deploy parse-nfe
supabase functions deploy match-nfe-items
```

### 5. Start

```bash
npm run dev
```

Abre em `http://localhost:5173`.

---

## Estrutura

```
gastao-app/
├── src/
│   ├── components/       # Layout, ExcelImporter, etc.
│   ├── contexts/         # AuthContext (sessão + perfil + branding do restaurante)
│   ├── hooks/            # usePermissions
│   ├── lib/              # supabase client, costCalculator, format, nfe, theme
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── Ingredients.tsx
│   │   ├── Preparos.tsx
│   │   ├── Recipes.tsx       (fichas técnicas finais)
│   │   ├── Sales.tsx
│   │   ├── NotasFiscais.tsx
│   │   ├── Equipe.tsx
│   │   ├── Checklists.tsx    ← novo
│   │   ├── Feedbacks.tsx     ← novo
│   │   ├── Onboarding.tsx
│   │   ├── Login.tsx
│   │   ├── Register.tsx
│   │   ├── ResetPassword.tsx
│   │   └── UpdatePassword.tsx
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css         # Tailwind 4 @theme com tokens da marca
├── supabase/
│   ├── migrations/       # SQL versionado
│   └── functions/        # Edge Functions (parse-nfe, match-nfe-items)
├── index.html
└── package.json
```

---

## Arquitetura

### Multi-tenant

Cada restaurante é isolado por `restaurant_id`. Toda tabela de domínio tem essa coluna e uma política de Row Level Security que usa o helper `get_my_restaurant_id()` — que lê do `auth.uid()` e resolve via tabela `membros`.

### Receitas em 3 camadas

1. **Insumos** (`ingredients`) — matéria-prima, entra via NFe ou cadastro manual. Custo médio ponderado calculado automaticamente.
2. **Preparos** (`recipes` com `tipo='preparo'`) — mini-receitas reutilizáveis (molho, massa, base). Têm `yield_quantity` pra calcular custo por unidade.
3. **Fichas técnicas finais** (`recipes` com `tipo='ficha_final'`) — produtos vendidos, compostos por insumos diretos + preparos (via `recipe_sub_recipes`).

O custo da ficha final é calculado na UI via `src/lib/costCalculator.ts` e usado pra calcular CMV no dashboard.

### Perfis e permissões

- **Dono** — acesso total, incluindo convidar e remover membros.
- **Gerente** — acesso total a dados operacionais e financeiros, sem gestão de equipe.
- **Funcionário** — view operacional: checklists, feedbacks, preparos, fichas técnicas. Não vê custos, CMV, vendas ou insumos.

Controlado via `usePermissions()` hook + `RoleRoute` wrapper no `App.tsx`.

### Branding por tenant

Cada restaurante pode customizar `brand_color` e `logo_url` (colunas em `restaurantes`). O `AuthContext` lê esses valores no login e o `Layout` injeta via CSS custom property.

---

## Identidade visual

Definida no manual da marca (pasta `../Bibliografia/`). Tokens extraídos em:

- `src/lib/theme.ts` — constantes TS
- `src/index.css` — Tailwind 4 `@theme` (classes `bg-primary-*`, `text-ink`, `text-warm-gray`, `bg-cream`, `font-display`)

**Paleta principal**
- Laranja primário: `#FF6B35`
- Verde sucesso: `#4CAF50`
- Bege: `#D4A574`
- Cinza quente (textos): `#6B6B6B`
- Ink (títulos): `#2C2C2C`
- Cream (fundo): `#FAF6EE`

**Tipografia**
- Display: Ytre Bold / Poppins (fallback)
- Sans: Poppins

**Voz da marca**
- prático · inteligente · calmo · confiável
- Trata o usuário por você, não usa jargão técnico, puxa a orelha quando precisa (mas sempre do lado do dono).

---

## Scripts

```bash
npm run dev       # Vite dev server
npm run build     # tsc + build de produção
npm run preview   # preview do build
```

---

## Roadmap curto

- [ ] Extrair migration `000_setup.sql` a partir do schema atual
- [ ] Integrar Checklists e Feedbacks no Dashboard (pendências do dia, feedbacks não lidos)
- [ ] Push notifications (PWA) pra feedbacks urgentes e checklists atrasados
- [ ] Relatórios: histórico de checklists concluídos × pendentes, heatmap por funcionário
- [ ] Onboarding guiado pós-signup
