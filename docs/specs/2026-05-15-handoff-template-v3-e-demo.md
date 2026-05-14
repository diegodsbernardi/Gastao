# Handoff — Template v3 + Demo BRUT — sexta 2026-05-15

**Data:** 2026-05-14 (quarta noite)
**De:** Diego + Claude (Windows local)
**Pra:** Diego + Claude (terminal do Armazém)
**Status:** **Template v3 gerado e committado.** Demo BRUT pronta. Falta validar v3 + executar a demo.

---

## TL;DR

Duas frentes paralelas:

1. **Demo BRUT (sexta às ?)** — tudo pronto no banco: 6 fichas curadas, 14 vendas inseridas, CMVs saudáveis (20-32%). Falta convites Vanessa/Dani, smoke test, e roteiro. Detalhes no handoff `2026-05-14-handoff-demo-brut-sexta.md` (committado).

2. **Planilha-Mãe v3 — chef-friendly** — gerada hoje à noite. Mudança estrutural pra resolver os 10 problemas que a BRUT custou ~15h de fix manual. Pronta pra testar com a chef da BRUT na próxima semana.

**Arquivo gerado:** `gastao-app/public/Gastao_Planilha_Mae_v3.xlsx` (committado, 65KB).

---

## Contexto da v3 — por que existe

A v2 (atual) é boa pra parser, ruim pra chef:
- Chef precisa pensar em "preço por grama" (R$ 0,043/g) → confuso
- Aproveitamento em 1 campo único sem explicação → preenchem 100% pra tudo
- Nenhuma validação cruzada visível → erros chegam no importador
- Sem visualização ficha-por-ficha → chef tem que ler tabela longa
- Custo final invisível enquanto preenche → desmotiva

**Custos que isso teve com a BRUT (ver handoff cobrança):**
- ~15h limpando dados na origem
- 9 bugs do app descobertos só porque dado real do cliente expôs
- Mistura escala (kg vs g na mesma coluna), preço cadastrado em unidade fracionária errada (shoyu R$ 139,80/ml em vez de /L), etc.

A v3 corrige isso na ORIGEM: o Excel recusa entrada inválida via dropdown, mostra erro em vermelho, calcula custo em tempo real.

## Mudanças estruturais v2 → v3

### Insumos — chef pensa em embalagem, não em grama

Schema antigo (v2): `Nome | Categoria | Tipo | Unidade | Preço Compra | Aprov | Obs`
- "Unidade" e "Preço Compra" se referem à unidade canônica (g, ml, un). Chef tem que fazer matemática: "compro 1kg por R$ 43 = R$ 0,043/g".

Schema novo (v3): `Nome | Categoria | Tipo | Embalagem (qtd) | Embalagem (unidade) | Preço Embalagem (R$) | Aproveitamento | Densidade | Unidade Canônica (auto) | Custo/un (auto) | Obs`
- Chef cadastra: "compro embalagem de 1000 g por R$ 43". Sistema calcula R$ 0,043/g.
- "Embalagem (unidade)" aceita kg/g/l/ml/un (não força ser canônica).
- "Unidade Canônica (auto)" é fórmula: kg/g → g, l/ml → ml.
- "Custo/un (auto)" é fórmula: preço ÷ (qtd × 1000 se kg/l, senão qtd).

### Aproveitamento — tabela de referência no _Leia-me

V2 tinha um campo sem contexto.
V3 tem o mesmo campo + tabela com casos comuns no _Leia-me:
- Bacon cru → frito: 30%
- Camarão com casca → limpo: 60%
- Tomate pelado em lata (drenado): 60%
- Cebola descascada: 90%
- etc.

Chef olha a tabela e copia o número. Não precisa decompor mentalmente.

### Preparos e Fichas — custo + CMV em tempo real

V2: chef preenche, vê custo só quando importa.
V3: cada preparo mostra `Custo Total (auto)` e `Custo/un (auto)` via SUMIFS na composição. Cada ficha mostra `Custo Total` e `CMV %` com cores condicionais (verde < 25%, amarelo 25-35%, vermelho > 35%).

Motivacional: chef vê o R$ subindo conforme preenche. Vira gamificação.

### Composições — custo da linha + aproveitamento aplicado

V2: composição mostrava só nome, qtd, unidade.
V3: adiciona `Aprov% (auto)`, `Custo/un (auto)` (do item), e `Custo da Linha (auto)` calculado com aproveitamento. Chef vê quanto custa CADA item da receita.

### Ver_Ficha — nova aba de visualização

Dropdown no topo, escolhe a ficha, mostra:
- Nome, categoria, preço, custo total, CMV
- Lista de ingredientes com qtd + custo
- Tudo via INDEX+SMALL+ROW (filter array)
- Read-only, pode imprimir

### _Validação — nova aba de erros

8 testes automáticos com status (🔴 erro / 🟡 aviso / ✅ OK):
- Insumos sem preço
- Preparos sem rendimento
- Fichas sem preço de venda
- Comp_Preparos com Item não encontrado (= ingrediente fantasma)
- Comp_Fichas com Item não encontrado
- Fichas com CMV impossível (<5% ou >70%)
- Preparos sem composição
- Fichas sem composição

Conditional formatting destaca linhas vermelhas. Total no final.

### Cores semânticas

- 🟡 Amarelo claro = chef preenche aqui (obrigatório)
- 🟢 Verde claro = sistema calcula (não toque)
- ⚪ Cinza claro = opcional
- 🔴 Vermelho = erro detectado

## Estado técnico

### Repo
- Branch: `master`
- Último commit: `1f3e2d6 feat(template-v3): planilha-mae v3 chef-friendly`
- Arquivos novos:
  - `gastao-app/scripts/generate-template-v3.mjs` (863 linhas, gerador)
  - `gastao-app/public/Gastao_Planilha_Mae_v3.xlsx` (65 KB, output)
- Para regerar: `cd gastao-app && node scripts/generate-template-v3.mjs`

### Banco prod (BRUT)
- 1 restaurante, 14 vendas inseridas (~R$ 58k abril)
- 6 fichas com CMV: Arancini 32%, Bruschetta 27%, Croqueta 4% (intencional), Filé parm 25%, Filé aligot 22%, Petit gateau 24%
- 15 coquetéis CMV 25%

### Deploy
- Prod: https://gastao-app.vercel.app
- Última atualização ontem (sales filter "Tudo", fmtMoney 4 decimais, etc)
- v3 xlsx vai ser servido em `/Gastao_Planilha_Mae_v3.xlsx` no próximo deploy
- Deploy: `cd gastao-app && npx vercel --prod --yes`

## Pendências SEXTA (ordem de prioridade)

### Bloco 1 — Pré-demo (manhã, ~30min)

1. **Verificar vendas no banco BRUT**
   ```sql
   SELECT count(*), sum(total_value) FROM sales;
   -- Esperado: 14, R$ 58.328
   ```
   Se vazio, rodar INSERT do handoff `2026-05-14-handoff-demo-brut-sexta.md`.

2. **Convidar Vanessa + Dani**
   - App → Menu **Equipe** → criar convite
   - Email da Vanessa, perfil **gerente**
   - Opcional: Dani

3. **Smoke test logando como Vanessa** (aba anônima)
   - Dashboard abre
   - `/recipes` mostra 6 fichas com CMV
   - `/sales` mostra 14 vendas (clicar filtro "Tudo")
   - Filtro multi-categoria funciona
   - Permissões: gerente NÃO pode deletar restaurante

### Bloco 2 — Durante demo (sexta)

Roteiro sugerido em `2026-05-14-handoff-demo-brut-sexta.md`. Resumo:
1. Dashboard → faturamento R$ 58k cadastrado
2. `/recipes` → 6 fichas com CMV (mostrar Filé com aligot top seller, Bruschetta cascata de 3 preparos)
3. Croqueta CMV 3,6% → **conversation point premium** ("1 ajuste corrige todas as fichas")
4. `/preparos` → dependências entre preparos
5. `/sales` → comparação CMV teórico vs real
6. **Apresentar v3 da Planilha-Mãe** (download `/Gastao_Planilha_Mae_v3.xlsx`)
   - Mostra: validação interna, cores semânticas, custo em tempo real, Ver_Ficha bonita
   - Vende: "Onboarding novo, padronizado, sem dor"

### Bloco 3 — Pós-demo (ainda sexta ou começo da semana)

1. **Testar v3 com a chef da BRUT**
   - Pedir pra ela tentar cadastrar 2-3 fichas reais novas
   - Coletar fricções (o que confundiu, o que deixou em branco)
   - Iterar v3.1 baseado em feedback real

2. **Negociação Cinco**
   - Proposta concreta:
     - Setup R$ 600/restaurante (one-shot, inclui onboarding com template v3)
     - Software R$ 99/restaurante/mês
     - Auditoria mensal R$ 150/restaurante (opcional)
     - Cinco embute markup deles no preço final
   - 10 restaurantes da Cinco = R$ 6k setup + R$ 1-2,5k/mês recorrente
   - Pitch da Cinco: "Setup pago + recorrência sustentável, sem precisar de equipe técnica"

## Backlog técnico (não-bloqueante)

### v3 da planilha — melhorias futuras

- [ ] Testar v3 em LibreOffice (open-source, Linux) — algumas validações Excel não funcionam em LO
- [ ] Testar v3 em Excel Mac (Data Validation tem quirks)
- [ ] Aba "Ver_Preparo" análoga à Ver_Ficha (chef visualizar preparos compostos)
- [ ] Mais testes na _Validação: ciclos preparo→preparo, unidade inconsistente
- [ ] Adaptar ExcelImporter no app pra aceitar v3 schema novo (Embalagem qtd + unidade em vez de Unidade direta + Preço)
- [ ] PDF de instrução de 1-page pro chef (visual, com prints da planilha)
- [ ] Vídeo Loom 5min "Como preencher" (você grava, eu posso te ajudar com roteiro)

### App Gastão — pendências conhecidas

- [ ] Cache invalidation entre rotas (edita preparo, /recipes não atualiza até hard refresh)
- [ ] Alertas de CMV alto configurável por restaurante
- [ ] Filtro por categoria em /ingredients (já tem em /recipes e /preparos)
- [ ] Refactor pra React Query (resolve cache + stale-while-revalidate)
- [ ] Sales: importar CSV/XLSX em vez de inserção manual
- [ ] Sales: gráfico CMV teórico vs real no Dashboard

### Plano B2B2B via Cinco (estratégico)

Ver `2026-05-05-handoff-pivot-b2b2b-cinco.md`. Plano técnico (12-18h):
1. Painel BPO multi-restaurante (Cinco vê todos clientes num lugar)
2. White-label leve (logo + cor primária por BPO)
3. Onboarding assistido (Cinco sobe planilha + valida em 1 clique)
4. NFe automática SEFAZ Fase 1
5. Mobile read-only PWA

## Decisões pendentes — pergunta no início da próxima sessão

1. **v3 já vai pro deploy?** O xlsx está em `public/` mas o app ainda baixa v2 quando clica "Baixar Template". Pra v3 virar default, mudar `downloadTemplate()` em `gastaoTemplate.ts` ou criar dois botões ("v2 estável" + "v3 beta").

2. **Manter v2 ativo?** v3 é experimento; v2 é o que outros clientes (se houver) usam. Decisão: rolar v3 só pra BRUT durante teste, manter v2 default.

3. **Adaptar ExcelImporter pra v3?** O schema novo tem novas colunas (Embalagem qtd + unidade em vez de Unidade direta). Importador atual quebra com v3. Precisa update — provavelmente 1-2h.

4. **Negociação Cinco — você tem reunião marcada?** Define timing das próximas entregas.

## Como continuar no terminal amanhã

```bash
cd <pasta-do-repo>
git pull
claude
```

Primeira mensagem:
> "Lê `docs/specs/2026-05-15-handoff-template-v3-e-demo.md`. Hoje é o dia da demo BRUT — começa verificando vendas no banco, depois me ajuda com smoke test + roteiro. Em paralelo precisamos pensar como o ExcelImporter vai aceitar a v3."

Claude lá vai ter:
- Esse handoff
- Handoff anterior `2026-05-14-handoff-demo-brut-sexta.md`
- `MEMORY.md`
- `CLAUDE.md` do repo
- Git log dos últimos 30 commits dessa semana

Suficiente pra continuar.

---

**Boa noite. Foi uma jornada hoje, mas a v3 ficou linda. Demo amanhã vai dar bom — você tem munição pra vender setup + recorrência via Cinco depois.**
