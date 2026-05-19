# Handoff — Sessão nova Gastão (terça 2026-05-19)

**De:** Diego + Claude (sessão anterior)
**Pra:** Claude (sessão nova)
**Status:** Onboarding completo pra continuar o projeto Gastão sem perder contexto.

---

## TL;DR — O que é o Gastão

SaaS de gestão de ficha técnica + CMV pra restaurantes, fork do TOCS (sistema anterior do Diego). Stack: React + TS + Tailwind, Supabase backend, deploy Vercel.

**Estado de produto:** importador de planilha-mãe funcionando, gestão de insumos / preparos / fichas com cálculo de CMV em tempo real, checklists, feedbacks, NFe parser, multi-tenant com RLS.

**Estado comercial:** rodada de validação com 1º cliente (BRUT & Rose Garden) via canal BPO contábil **Cinco**. Estratégia confirmada é **B2B2B**: vender pro BPO, não pro restaurante direto.

**Hoje (2026-05-19) — terça-feira após a demo BRUT (sexta 2026-05-15).** Próxima fase: implementar feature âncora de **estoque de produção** + começar adaptação pra modelo B2B2B (painel BPO, white-label).

---

## Pergunte antes de agir

A sessão anterior fechou na **quinta noite 14/05**, prevendo demo na **sexta 15/05**. Hoje é **19/05** — 4 dias depois. Comece perguntando ao Diego:

1. **Como foi a demo da BRUT na sexta?** Vanessa/Dani ficaram a fim? Levantaram dúvidas?
2. **A planilha v3 foi enviada pro chef da BRUT preencher?** Já voltou algo?
3. **A Cinco quer fechar o negócio?** Algum próximo passo comercial agendado?
4. **Você começou alguma coisa pós-demo?** Stock de produção? Outra feature?

Antes dessas respostas, não comece a codar nada — pode estar duplicando trabalho ou indo na direção errada.

---

## Estado técnico (verificado em 14/05 à noite)

### Repo
- Branch: `master`
- Último commit confirmado: `599b672 docs(handoff): pos-demo — feature de estoque de producao com modelo corrigido`
- Rode `git log --oneline -15` no início pra ver se houve commits novos depois desse.

### Deploy prod
- URL: https://gastao-app.vercel.app
- Conta: `tocsbs@gmail.com` (Supabase + Vercel)
- Deploy manual: `cd gastao-app && npx vercel --prod --yes`
- Banco Supabase: projeto `hvnxvqycvnwquugnygzf` (free tier — pode pausar por inatividade)

### Banco BRUT (estado em 14/05)
- 1 restaurante: BRUT & Rose Garden
- 6 fichas-âncora cadastradas com CMV calculado
- 17 preparos curados
- 419 insumos
- 14 vendas inseridas de abril/2026 (R$ 58k total)

Pra verificar estado atual antes de mexer em algo:

```sql
SELECT
    (SELECT COUNT(*) FROM ingredients) AS insumos,
    (SELECT COUNT(*) FROM recipes WHERE tipo='preparo') AS preparos,
    (SELECT COUNT(*) FROM recipes WHERE tipo='ficha_final') AS fichas,
    (SELECT COUNT(*) FROM sales) AS vendas,
    (SELECT COUNT(*) FROM restaurantes) AS tenants;
```

---

## Threads abertas em ordem de prioridade

### 1. 🥇 Estoque de produção (feature âncora — Sprint 1-5)

Spec completa em `docs/specs/2026-05-15-handoff-pos-demo-estoque-producao.md`.

**Modelo conceitual chave (Diego corrigiu na noite de 14/05):**
> Cascata acontece SÓ NA PRODUÇÃO, não na venda. Quando vende Filé com aligot, deduz 200g do estoque de Aligot pronto, **não** os ingredientes do Aligot. Os ingredientes já foram deduzidos lá quando o chef produziu o Aligot.

**Esforço:** 10-14h em 5 sprints.
**Sprint 1 (~3h):** migration 017 (`stock_movements` + `productions` + view + RLS) + função `register_production`. SQL pronto no handoff acima.

**Por que é âncora:** Saipos/Konclui não têm isso pra sub-receitas. Vira killer feature na venda B2B2B.

### 2. 🥈 Planilha-Mãe v3 (template chef-friendly)

Spec completa em `docs/specs/2026-05-15-handoff-template-v3-e-demo.md`.

**Estado:** gerada e commitada (`scripts/generate-template-v3.mjs` + `public/Gastao_Planilha_Mae_v3.xlsx`). 10 abas com:
- Insumos pensando em "embalagem" (chef cadastra "1 kg por R$ 43" e sistema calcula preço/g sozinho)
- Aproveitamento com tabela de referência no _Leia-me
- Custos + CMV em tempo real via fórmula
- Aba Ver_Ficha (visualização bonita)
- Aba _Validação (erros automáticos)
- Cores semânticas (amarelo input, verde auto, cinza opcional, vermelho erro)

**Pendente:**
- Adaptar `ExcelImporter.tsx` no app pra aceitar schema v3 (~1-2h)
- BRUT testar preenchendo fichas reais
- Coletar feedback e gerar v3.1

### 3. 🥉 Pivot B2B2B via Cinco

Spec inicial em `docs/specs/2026-05-05-handoff-pivot-b2b2b-cinco.md`.

**Modelo de receita proposto:**
- Setup R$ 500-1.500/restaurante (one-shot, Cinco faz onboarding com template v3)
- Software R$ 99-149/restaurante/mês (recorrente)
- Auditoria mensal R$ 150-250 (opcional)
- Cinco embute markup deles

**Stack técnico pra implementar pra Cinco:**
1. Painel BPO multi-restaurante (~3-4h)
2. White-label leve — logo + cor por BPO (~1-2h)
3. Onboarding assistido — Cinco sobe planilha do cliente (~2-3h)
4. NFe automática SEFAZ Fase 1 (~4-6h)
5. Mobile read-only PWA (~2-3h)

**Status comercial:** depende da conversa com Dani/Cinco pós-demo BRUT. Pergunta o Diego.

### 4. Backlog menor (em ordem)
- Cache de dados entre rotas (resolve "pisca em branco" definitivamente — `recipesCache`/`preparosCache` atual é gambiarra de módulo)
- Alertas de CMV alto configurável por restaurante
- Filtro por categoria em `/ingredients` (já tem em fichas e preparos)
- Migração de `recipe_ingredients.sub_recipe_id` legado pra `recipe_sub_recipes` (limpar dívida)
- Importador adaptar pra schema v3

---

## Decisões já tomadas — NÃO discutir de novo

- ✅ B2B2B via BPO Cinco confirmado (não vai pra B2C self-service)
- ✅ Unidades canônicas são **g/ml/un** (não kg/L) — template v3 usa essa premissa
- ✅ Stock-of-production: cascata só na produção (não na venda) — Diego corrigiu explicitamente
- ✅ Template v3 mantém v2 ativo durante transição (clientes legados não quebram)
- ✅ "Modo Tabela" no template — não "uma planilha por ficha" estilo BRUT antiga

---

## Cliente: BRUT & Rose Garden

- **Restaurante real**, primeiro cliente, chegou pelo BPO Cinco
- **Contatos:** Vanessa (gerente) + Dani (Cinco — financeiro/contábil)
- **Faturamento abril/2026:** R$ 243.421 (do PDF de vendas)
- **Cardápio:** italiano upscale (Bruschetta, Filé a parmegiana, Filé com aligot, Petit gateau, etc) + 15 coquetéis + carta de vinhos
- **Planilha original deles:** 22 abas, 215 fichas técnicas, formato proprietário com problemas estruturais conhecidos
- **Vão ser nossos testadores principais** da v3 e features novas (não só caso de uso de demo)

---

## Bugs conhecidos pendentes

1. **Auto-conversão de unit_type** quando edita preparo no app desfaz quantidades em composições dependentes — sem warning. Risco médio. Mitigation: anotado, fix junto com o refactor do React Query.
2. **Cache de módulo entre rotas** funciona mas é gambiarra — edita preparo, /recipes não atualiza até hard refresh. Fix: React Query.
3. **Inconsistência de tabelas pra preparo→preparo**: hoje vive em `recipe_ingredients.sub_recipe_id` (UI manual) E `recipe_sub_recipes` (importador). Mitigation: app lê de ambas (dedup), mas é dívida. Migração pra UMA tabela só é roadmap.
4. **`fmtQty` vs display direto de `quantity_needed`**: alguns lugares mostram "0.15" (sem 3 decimais BR). Cosmético.
5. **Página `/sales` sem importer XLSX/CSV**: hoje é insert manual via UI ou SQL. Vendas reais entram por SQL.

---

## Estrutura de arquivos chave

```
gastao-app/
├── src/
│   ├── pages/
│   │   ├── Recipes.tsx         (~1200 linhas, fichas)
│   │   ├── Preparos.tsx        (~1100 linhas, preparos)
│   │   ├── Ingredients.tsx     (insumos)
│   │   ├── Sales.tsx           (vendas, com filtro "Tudo")
│   │   ├── ImportarFichaTecnica.tsx  (rota /importar — usa ExcelImporter)
│   │   ├── Dashboard.tsx
│   │   ├── NotasFiscais.tsx    (NFe parser)
│   │   ├── Checklists.tsx
│   │   └── Feedbacks.tsx
│   ├── components/
│   │   ├── ExcelImporter.tsx   (importador deterministico, ~600 linhas)
│   │   └── Layout.tsx          (sidebar + nav)
│   ├── contexts/AuthContext.tsx (multi-tenant + visibilitychange fix)
│   ├── lib/
│   │   ├── supabase.ts
│   │   ├── costCalculator.ts   (buildPreparoCostMapRecursive — DFS + ciclo)
│   │   ├── gastaoTemplate.ts   (parser do template no app)
│   │   └── format.ts           (fmtMoney com 4 decimais se < R$0,01)
│   └── App.tsx                 (rotas + AuthContext)
├── scripts/
│   ├── generate-template.mjs       (v2 — atual default)
│   ├── generate-template-v3.mjs    (v3 chef-friendly — em teste)
│   ├── convert-brut.mjs            (conversor planilha BRUT proprietária)
│   ├── curate-demo.mjs             (filtra planilha pro subset da demo)
│   └── reset-tudo.sql              (wipe transacional preservando users)
├── supabase/migrations/    (000-016 atuais)
├── public/
│   ├── Gastao_Planilha_Mae.xlsx       (v2 — servida em /Gastao_Planilha_Mae.xlsx)
│   └── Gastao_Planilha_Mae_v3.xlsx    (v3 — não default ainda)
└── docs/specs/
    ├── 2026-04-23-apresentacao-e-sefaz-roadmap-design.md
    ├── 2026-05-05-handoff-pivot-b2b2b-cinco.md
    ├── 2026-05-13-handoff-brut-demo-sexta.md
    ├── 2026-05-14-handoff-demo-brut-sexta.md
    ├── 2026-05-15-handoff-template-v3-e-demo.md
    ├── 2026-05-15-handoff-pos-demo-estoque-producao.md
    └── 2026-05-19-handoff-sessao-nova.md  (este aqui)
```

---

## Como continuar

1. **Pergunta os 4 itens da seção "Pergunte antes de agir"** (no topo)
2. **Roda o SELECT de estado do banco** pra confirmar onde tá
3. **Verifica git log -15** — vê se commitou algo entre 14/05 e hoje
4. **Decide com Diego qual thread atacar primeiro:**
   - Se demo foi bem e Cinco quer fechar → começa Sprint 1 do estoque de produção
   - Se demo expôs problema → ajusta primeiro
   - Se Diego quer iterar v3 com BRUT → adapta ExcelImporter pra v3

**Não chuta. Pergunta.**

---

## Filosofia do projeto (importante)

Diego é:
- Pragmático ("entrega e cobra pelo feito", mentalidade de agência)
- Não-técnico (não codifica, mas entende o negócio profundamente)
- Detalhista em produto (pega bugs visuais que outros não veriam)
- Direto na comunicação (não floresce, vai direto ao ponto)
- Frustrado com setup técnico complexo (SSH/SQL via terminal teve atrito antes — preferia SQL Editor browser do Supabase)

Funciona melhor quando você:
- Dá opções claras com trade-offs honestos
- Quantifica esforço em horas
- Não promete o que não dá (anota como roadmap)
- Mostra screenshot/preview antes de commitar destrutivo
- Pergunta antes de chutar — Diego documentou esse pedido em memória (`feedback_no_guessing.md`)

---

**Bem-vindo à sessão. Pergunta as 4 questões, lê o estado, e vamos.**
