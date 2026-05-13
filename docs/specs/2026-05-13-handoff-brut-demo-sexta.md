# Handoff — Demo BRUT sexta 2026-05-15

**Data:** 2026-05-13 (quarta)
**De:** Diego + Claude (sessão web/desktop)
**Pra:** Diego + Claude (próxima sessão, terminal)
**Status:** Conversor BRUT corrigido e rodando. Falta importar no tenant e validar.

---

## TL;DR

Demo da BRUT é **sexta 2026-05-15** pra Vanessa e/ou Dani. Objetivo mínimo:
- Tenant da BRUT limpo
- User da Vanessa (e/ou Dani) criado e logando
- Fichas técnicas (pratos + vinhos/coquetéis) cadastradas
- CMV teórico calculado e visível na tela

"Próxima fase" (pode mostrar como roadmap, não precisa funcionar): NFe automática, faturamento integrado, integração Colibri.

## O que foi feito nessa sessão (2026-05-13)

Corrigi os 3 bugs do `scripts/convert-brut.mjs` documentados no handoff anterior:

1. ✅ `parseBlocos`: nome da receita estava em `header[4]`, virou `header[5]` (col F 0-indexed); código estava em `header[3]`, virou `header[4]`
2. ✅ `parseBlocos`: header "INGREDIENTES" estava em col 1, virou col 2 (idx 2)
3. ✅ `parseEstoque`: adicionado skip pra "Nome da Receita", "Nome do Prato", "Frutas frescas", "x", "-"

Também: o output passou a ser timestamped (`Brut_Planilha_Mae_<ISO>.xlsx`) pra não conflitar com Excel aberto.

**Resultado da última run:**
- 419 insumos (16 auto-criados sem preço — lista no log)
- 119 preparos
- 63 fichas (48 food com sale_price=0 + 15 coquetéis com preço sugerido CMV 25%)
- 602 linhas de Composicao_Preparos
- 331 linhas de Composicao_Fichas

**Output pronto pra importar:**
`gastao-app/fichas brut/Brut_Planilha_Mae_2026-05-13T17-04-54.xlsx`

Sanity check do conteúdo passou — categorias mapeadas (Molhos & Caldos, Bases, etc), unidades válidas, composições com referências corretas.

## Backlog imediato (sexta da demo)

### Bloco 1 — Limpar tenant e importar (Diego faz, ~10min)

⚠ **Antes de qualquer reset, conferir os tenants existentes:**

```sql
SELECT id, nome FROM restaurantes;
```

- Se vier **só BRUT** → roda `gastao-app/scripts/reset-tudo.sql` direto (preserva restaurantes/profiles/membros/convites)
- Se vier **mais de um restaurante** → reset-tudo zera TODOS. Preciso escrever um SQL filtrado por `restaurant_id` da BRUT antes (pendente).

Depois do reset:
1. Logar no app como dono da BRUT
2. Menu **"Importar Planilha"** → upload do `Brut_Planilha_Mae_2026-05-13T17-04-54.xlsx`
3. Acompanhar o log do importador (insumos → preparos topo-sorted → fichas → composições)

### Bloco 2 — Validar (Claude valida via screenshot, ~15min)

Depois do import, Diego abre `/recipes` e `/preparos` no app prod e manda screenshot. Claude valida:
- Preparos têm composição preenchida (não vazio)?
- Fichas com preparos linkados aparecem como **Preparos** (não como **Insumos**)?
- CMV calculado faz sentido (não zero massivamente)?
- Há erros vermelhos visíveis?

### Bloco 3 — Cleanup manual (Diego faz, ~30min)

Pra demo ficar boa:

1. **48 fichas food com sale_price=0**: editar no app pra colocar preço de venda. Sem preço = CMV % não calcula.
2. **16 insumos sem preço** (lista no log): adicionar preço de compra no app:
   - açúcar mascavo, aparas de filé, estragão, pomodoro, massa lasanha
   - raspa de laranja, raspa de limao siciliano, camarao, limao tahiti
   - caldo de carne, café, casca de laranja, grao de bico
   - farofa de limão, broto, sour cream

### Bloco 4 — User da Vanessa (Diego faz no app, ~5min)

No menu **Equipe**, criar convite pra `vanessa@brut.com.br` (ou email real dela) como **gerente**. Mesma coisa pra Dani se for o caso. Aceitar convite via email.

### Bloco 5 — Smoke test logando como Vanessa (Diego faz, ~10min)

Sair, logar com user dela, validar que:
- Dashboard abre
- Vê fichas técnicas
- Vê CMV
- Permissões funcionam (gerente NÃO pode deletar restaurante)

### Bloco 6 — Roteiro da demo (Diego + Claude, ~30min antes da apresentação)

Estruturar a narrativa:
- "Olha como suas fichas estão no sistema com CMV por prato"
- "Cardápio inteiro precificado em segundos"
- "Filtros por categoria, sort por CMV"
- Próxima fase: NFe automática, integração Colibri

## Estado do mundo

### Repo
- Branch: `master` (pushed)
- Último commit: `2d7d408 fix(convert-brut): corrige offsets do parseBlocos/parseEstoque`
- No servidor: `git pull` traz os fixes + esse handoff.

### Deploy
- Prod: https://gastao-app.vercel.app — atualizada hoje (deploy `dpl_FWMdWQNT7CfU56hyrTkvPT4ra9vJ`)
- Deploy: `cd gastao-app && npx vercel --prod --yes`

### Cinco (B2B2B, pós-demo)
Respostas do Diego nessa sessão pras 3 perguntas pendentes:
1. **Cinco NÃO é empresa do Diego** — é parceiro/cliente externo
2. **Cinco tem ~10 restaurantes** no BPO, crescendo
3. **Modelo de cobrança Cinco↔Gastão: aberto** (estavam discutindo)

Sugestão da Claude pra negociação Cinco (depois de sexta):
- **Setup pago** por restaurante onboarded (alinha com cabeça de agência do Diego)
- **Mensalidade recorrente** por restaurante ativo
- Exemplo: R$ 500 setup + R$ 99/restaurante/mês. BPO cobra cliente final R$ 250-350, fica com R$ 150-250 de margem.

Plano técnico B2B2B (12-18h) descrito em [2026-05-05-handoff-pivot-b2b2b-cinco.md](2026-05-05-handoff-pivot-b2b2b-cinco.md) — fica pra próxima semana, **depois da demo BRUT**.

## Arquivos-chave dessa sessão

- [gastao-app/scripts/convert-brut.mjs](../../gastao-app/scripts/convert-brut.mjs) — conversor BRUT (3 bugs corrigidos, output OK)
- [gastao-app/fichas brut/Brut_Planilha_Mae_2026-05-13T17-04-54.xlsx](../../gastao-app/fichas%20brut/Brut_Planilha_Mae_2026-05-13T17-04-54.xlsx) — output pronto pra importar
- [gastao-app/fichas brut/Brut_Planilha_Mae_2026-05-13T17-04-54_LOG.txt](../../gastao-app/fichas%20brut/Brut_Planilha_Mae_2026-05-13T17-04-54_LOG.txt) — log completo da conversão
- [gastao-app/scripts/reset-tudo.sql](../../gastao-app/scripts/reset-tudo.sql) — wipe de dados transacionais preservando restaurante/users
- [gastao-app/src/pages/ImportarFichaTecnica.tsx](../../gastao-app/src/pages/ImportarFichaTecnica.tsx) — tela de upload (`/importar`)
- [gastao-app/src/components/ExcelImporter.tsx](../../gastao-app/src/components/ExcelImporter.tsx) — parser/inserter determinístico

## Como continuar no terminal

1. `cd C:\Users\usuario\Desktop\IA\Gastao`
2. `claude` (nova sessão) ou `claude --resume` se quiser pegar uma anterior
3. Primeira mensagem ali:
   > "Claude, lê `docs/specs/2026-05-13-handoff-brut-demo-sexta.md` — vamos terminar o setup da demo BRUT que é sexta."

Claude no terminal vai ter:
- Esse handoff
- `MEMORY.md` em `~/.claude/projects/C--Users-usuario-Desktop-IA-Gastao/memory/`
- `CLAUDE.md` do repo
- Histórico de commits

Suficiente pra continuar sem perder contexto.
