# Handoff — Pré-demo BRUT sexta (14/05 noite → 15/05)

**Data:** 2026-05-14 (quarta tarde)
**De:** Diego + Claude (Windows local)
**Pra:** Diego + Claude (terminal do Armazém)
**Status:** **Pronto pra demo** — falta convites, smoke test e roteiro.

---

## TL;DR

Sexta 2026-05-15 tem demo da BRUT pra Vanessa/Dani (apresentado via Cinco). Plano: mostrar **5 fichas curadas + 1 entrada + 15 coquetéis**, com vendas de abril/2026 pré-carregadas, pra discutir CMV teórico × real.

**Estado do tenant BRUT no app:**
- 419 insumos importados
- 17 preparos relevantes (subset curado das 119 originais)
- 21 fichas: 6 food + 15 coquetéis
- 14 vendas agregadas de abril (5 food + 9 coquetéis) = ~R$ 58.328 (24% do faturamento real do mês)

**6 cards-âncora prontos:**

| # | Ficha | Venda | Custo | CMV |
|---|---|---|---|---|
| 1 | Arancini | R$ 44,00 | R$ 14,10 | 32,1% 🟡 |
| 2 | Bruschetta | R$ 52,10 | R$ 13,87 | 26,6% 🟢 |
| 3 | Croqueta carne de panela | R$ 48,14 | R$ 1,74 | 3,6% 🟢⚠ |
| 4 | Filé a parmegiana | R$ 118,00 | R$ 29,83 | 25,3% 🟢 |
| 5 | Filé com aligot | R$ 104,00 | R$ 23,11 | 22,2% 🟢 |
| 6 | Petit gateau de doce de leite | R$ 36,00 | R$ 8,48 | 23,6% 🟢 |

Croqueta carne de panela com CMV 3,6% é **conversation point**: o empanamento foi cadastrado a R$ 1,26/un (provavelmente kg na realidade). Demonstra valor da ferramenta — "1 ajuste no cadastro corrige todas as fichas que usam".

## O que foi feito nessa sessão (2026-05-14)

### Importação + ajustes da BRUT
- Re-fix do conversor (`gastao-app/scripts/convert-brut.mjs`): 3 bugs do parser (offsets de col, "Nome da Receita" como insumo)
- Coerção massa↔volume densidade 1 pra lidar com mistura de unidades na BRUT
- Rendimento = soma da massa em g pros preparos (autocompensa erros de qty inflada)
- Script `scripts/curate-demo.mjs` que filtra a planilha pro subset da demo
- Output gerado: `fichas brut/Brut_Demo_Curado_2026-05-14T01-21-21.xlsx`

### Bugs corrigidos no app
- `/recipes` e `/preparos`: cache em módulo entre rotas (sem mais "pisca em branco" na navegação)
- `/recipes`: composição de ficha mostra unidade real (g/ml/un) em vez de "un" hardcoded
- `/recipes`: `preparoCostPerUnit` usa `buildPreparoCostMapRecursive` (resolve sub-preparos recursivamente)
- `/recipes`: lê sub-preparos de **ambas as tabelas** (`recipe_ingredients` + `recipe_sub_recipes`) com dedup
- Filtro multi-categoria em `/recipes` e `/preparos` (chips toggam; "Todas" limpa)
- `fmtMoney` mostra 4 decimais quando valor < R$ 0,01 (evita arredondar custo/g pra zero)

### Bugs no dado da BRUT corrigidos manualmente via SQL
- `shoyu dark`: preço estava R$ 139,80/ml → corrigido pra R$ 0,1398/ml (era /L)
- `creme de leite`: preço R$ 14,45/g → R$ 0,01445/g (era /kg)
- Aligot: alguém mudou unit_type de g→kg sem ajustar composições; revertido + composições multiplicadas por 1000
- Duplicação Aligot→Mix de queijos: existia em ambas as tabelas (qty=0.5 em `recipe_ingredients`, qty=500 em `recipe_sub_recipes`); deletada a duplicada

### Vendas inseridas (abril/2026, baseado no PDF que o Diego mandou)
- 5 fichas food (Bruschetta, Croqueta, Filé a parmegiana, Filé com aligot, Petit gateau)
- 9 coquetéis (APEROL, BRUT&ROSE, FITZGERALD, NEGRONI, MOSCOW MULE, PENICILIN, LIMOCCELO, GIN TÔNICA, CARAJILLO)
- Total: 14 vendas agregadas (1 linha por ficha) em 15/04/2026
- Receita: R$ 58.328 (24% do faturamento total do mês — R$ 243.421)

⚠ **Diego mencionou no fim da sessão que "as vendas não subiram"** — verificar antes da demo:
```sql
SELECT count(*), sum(total_value) FROM sales;
```
Esperado: 14 linhas, R$ 58.328 total. Se vier menor, re-rodar o INSERT abaixo.

## Pendências pra fechar antes da demo

### 1. Verificar/re-inserir vendas (~5min)
SQL de re-insert idempotente no final desse handoff.

### 2. Convidar Vanessa + Dani (~3min)
- App → Menu **Equipe** → Criar convite
- Email da Vanessa, perfil **gerente**
- (Opcional) Dani, perfil gerente ou funcionário

### 3. Smoke test (~5min)
- Logar com user da Vanessa (aba anônima)
- Confirmar: Dashboard abre, `/recipes` mostra 6 fichas, `/sales` mostra 14 vendas
- Confirmar permissões: gerente NÃO pode deletar restaurante

### 4. Roteiro de demo (~30min antes)

Sugestão de fluxo:

1. **Abre Dashboard** → "Olha o faturamento do mês (R$ 58k das fichas cadastradas), o CMV teórico consolidado"
2. **`/recipes`** → "Suas 6 fichas-âncora. Cada uma tem CMV calculado em tempo real"
   - Mostra Filé com aligot (top seller, CMV 22%) — "150g de Aligot custou R$ 2,24, batata + queijos + sal"
   - Mostra Bruschetta (CMV 26%) — cascata de 3 preparos (Tomate confit + Pesto + Mel trufado)
3. **Click numa ficha problemática** — Croqueta carne de panela (CMV 3%) — "esse CMV é impossível. Significa que algum insumo foi cadastrado errado. Vamos abrir o empanamento... R$1,26/un. Provavelmente é kg, não un. **1 ajuste, e todas as fichas que usam recalculam.**"
4. **Filtros multi-categoria** — "Filtra Entradas + Coquetéis pra ver mix"
5. **Sort por CMV** — "Ordena por CMV crítico — quem você precisa olhar primeiro"
6. **`/preparos`** — "Cada sub-receita usada em N fichas. Mudou o custo do Chutney? Atualiza em tudo."
7. **`/sales`** — "Histórico de vendas. Bruschetta 198x esse mês = R$ 10.316. Comparar com CMV teórico."
8. **(opcional) Importar Planilha** — "Tudo isso entrou via uma planilha. A Cinco te ajuda a preencher, sobe aqui, em 30s tá pronto."

**Próxima fase / roadmap** (não precisa funcionar na demo, mas você cita):
- NFe automática SEFAZ
- Faturamento integrado (PDV)
- Integração Colibri (PDV BRUT)

## Estado do mundo (técnico)

### Repo
- Branch: `master`
- Último commit: `6766367 feat(format): fmtMoney mostra 4 decimais quando valor < R$ 0,01`
- Commits relevantes dessa sessão (5 últimos):
  - `6766367 feat(format): fmtMoney mostra 4 decimais quando valor < R$ 0,01`
  - `d21d578 fix(recipes): le sub-preparos de AMBAS as tabelas`
  - `840173b feat(recipes,preparos): multi-categoria + fix custo de sub-preparo`
  - `076f134 Revert "fix(recipes): preparoCostPerUnit considera sub-preparos"`
  - `5a3eb4d fix(ui): cache em memoria entre rotas`

### Deploy prod
- URL: https://gastao-app.vercel.app
- Último deploy: 14/05 final da tarde
- Deploy: `cd gastao-app && npx vercel --prod --yes`

### Banco prod (`hvnxvqycvnwquugnygzf` — tocsbs@gmail.com)
- 1 restaurante (BRUT)
- 10 profiles (alguns órfãos de testes anteriores)
- 1 membro
- 0 convites pendentes

## SQL pra ter à mão amanhã

### Verificar vendas
```sql
SELECT count(*) AS total_vendas, sum(total_value) AS faturamento
FROM sales;
-- Esperado: 14 vendas, R$ 58.328
```

### Re-inserir vendas (se sumiram)
```sql
WITH r AS (SELECT id FROM restaurantes LIMIT 1),
     v(nome, qtd, preco, total) AS (
        VALUES
            ('Bruschetta',                    198::numeric, 52.10::numeric, 10316.00::numeric),
            ('Croqueta carne de panela',      222::numeric, 48.14::numeric, 10688.00::numeric),
            ('Filé a parmegiana',              39::numeric, 118.00::numeric, 4602.00::numeric),
            ('Filé com aligot',               146::numeric, 104.00::numeric, 15184.00::numeric),
            ('Petit gateau de doce de leite', 112::numeric, 36.00::numeric,  4032.00::numeric),
            ('APEROL SPRITZ',                 114::numeric, 44.00::numeric, 5016.00::numeric),
            ('BRUT&ROSE',                      64::numeric, 44.00::numeric, 2816.00::numeric),
            ('FITZGERALD',                     16::numeric, 48.00::numeric,  768.00::numeric),
            ('NEGRONI',                        23::numeric, 48.00::numeric, 1104.00::numeric),
            ('MOSCOW MULE',                    16::numeric, 38.00::numeric,  608.00::numeric),
            ('PENICILIN DEFUMADO',             24::numeric, 48.00::numeric, 1152.00::numeric),
            ('LIMOCCELO SPRITZ',               15::numeric, 44.00::numeric,  660.00::numeric),
            ('GIN TÔNICA',                     17::numeric, 40.00::numeric,  680.00::numeric),
            ('CARAJILLO',                      13::numeric, 54.00::numeric,  702.00::numeric)
    )
INSERT INTO sales (restaurant_id, recipe_id, quantity_sold, unit_price, total_value, sold_at)
SELECT r.id, rec.id, v.qtd, v.preco, v.total, '2026-04-15 22:00:00-03'::timestamptz
FROM r CROSS JOIN v
JOIN recipes rec ON rec.product_name = v.nome AND rec.restaurant_id = r.id;
```

### Dedup vendas (se rodou o INSERT 2x)
```sql
DELETE FROM sales
WHERE id IN (
    SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
            PARTITION BY recipe_id
            ORDER BY sold_at ASC, total_value DESC
        ) AS rn
        FROM sales
    ) sub
    WHERE rn > 1
);
```

### Resetar tudo (caso BRUT tenha sido bagunçada)
Arquivo: `gastao-app/scripts/reset-tudo.sql`. Preserva restaurantes/profiles/membros/convites, zera dados transacionais.

## Backlog pós-demo (anotado durante a sessão)

### Bugs descobertos na BRUT (precisam de ajuste de cadastro pelo chef)
- `Croqueta de carne de panela (empanamento)`: preço R$ 1,26/un — provavelmente é kg
- Várias ervas (louro, tomilho, salsão, manjericão) cadastradas como `un` mas usadas em `g` nas receitas — 60+ linhas descartadas
- Mel trufado, Molho demi atual, Picles cebola baby: yield em milhões de gramas (digitação errada da chef)

### Bugs no app pra arrumar pós-demo
- **App não pergunta antes de auto-converter qty ao mudar unit_type de preparo** → confunde cadastros. Ideal: warning + opção de manter qty.
- **Recipes.tsx tinha cálculo próprio paralelo ao /preparos** — unificado nessa sessão, mas vale revisar pra evitar drift futuro.
- **Inconsistência de tabela pra preparo→preparo**: tem em `recipe_ingredients.sub_recipe_id` (UI manual) e `recipe_sub_recipes` (importador). Migração pra UMA fonte só seria ideal.
- **Cache invalidation entre páginas**: edita preparo em `/preparos` → /recipes não vê até hard refresh. Ou usa React Query, ou disparar refetch nos consumidores.
- **fmtQty vs display de sub_recipe.quantity_needed**: alguns lugares mostram "0.15" (ponto, sem 3 decimais BR) em vez de "0,150" — padronizar.

### Features pedidas pelo Diego (backlog `project_gastao_backlog_pos_mvp.md`)
1. Sort de fichas por CMV (✅ já feito — dropdown na /recipes)
2. Alertas de CMV alto (threshold configurável por restaurante) — pendente
3. Filtro por categoria em Insumos (✅ feito em fichas e preparos, falta insumos)
4. Cache de dados entre rotas — feito parcialmente (módulo em memória); ideal é React Query

### Roadmap estratégico (pivot B2B2B via Cinco — handoff PC1 anterior)
Ver `docs/specs/2026-05-05-handoff-pivot-b2b2b-cinco.md` e `docs/specs/2026-05-13-handoff-brut-demo-sexta.md`.

Plano técnico pós-demo (12-18h):
1. Painel BPO multi-restaurante
2. White-label leve (logo + cor por BPO)
3. Onboarding assistido (Cinco sobe planilha do cliente)
4. NFe automática SEFAZ Fase 1
5. Mobile read-only PWA

## Como continuar amanhã no terminal do Armazém

1. `cd` no repo (provavelmente `/home/diego/projects/Gastao` ou similar no servidor)
2. `git pull` — pega os últimos commits
3. `claude` — nova sessão
4. Primeira mensagem:
   > "Lê `docs/specs/2026-05-14-handoff-demo-brut-sexta.md` — vamos fechar a demo da BRUT que é hoje. Começa verificando se as 14 vendas tão no banco."

Claude no terminal vai ter:
- Esse handoff
- `MEMORY.md` em `~/.claude/projects/...` (se mesma user account)
- `CLAUDE.md` do repo
- Git log

Suficiente pra continuar sem perder contexto.

⚠ Os arquivos `.xlsx` (planilha BRUT crua, planilha-mãe gerada) estão em `gastao-app/fichas brut/` que é gitignored — **não vão pro servidor automaticamente**. Se precisar reimportar, copia o `Brut_Demo_Curado_2026-05-14T01-21-21.xlsx` manualmente.

---

**Bom descanso. Vai dar bom amanhã.**
