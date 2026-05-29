# Handoff — NFe Bulk no meio + paralelo do Diego (2026-05-29)

**De:** Diego + Claude (terminal Armazém)
**Pra:** Diego + Claude (próxima sessão)
**Status:** Marco 3 do roadmap a 44%. Bucket Storage acabou de ser criado. Falta testar end-to-end e fazer upgrade do matcher.

---

## TL;DR — onde paramos

Diego saiu pra projeto paralelo no meio do Marco 3 (NFe Bulk). Quando voltar:

1. **Tudo pronto pra testar BulkUpload em prod** — bucket `nfe-xml` criado, policies aplicadas, código em prod.
2. **Próximo passo concreto:** baixar 3-5 XMLs da pasta `NotasEntrada` no Drive, subir via botão "Upload em lote" no app, validar progress + dedup.
3. **Depois disso:** upgrade do `match-nfe-items` (OpenAI gpt-4o-mini → Claude + cálculo de embalagem + cache).

---

## O que foi feito hoje (2026-05-27 → 29)

### Código novo

- **`gastao-app/src/pages/NotasFiscais.tsx`** — componente `BulkUploadView` (~220 linhas) ao lado do `UploadView` single existente:
  - Multi-file input + drag de pasta inteira
  - Loop sequencial chamando `uploadNfeXml()` (não paralelo — evita rate limit nas edge functions)
  - **Dedup soft client-side via `parseLightNFe()`** — parse leve no browser pra extrair `numero/cnpj/dataEmi`, query Supabase antes do upload pesado. Notas já existentes viram `duplicate` sem reprocessar (poupa Storage + edge function calls).
  - Progress estilo terminal preto (consistente com `ExcelImporter`)
  - Resumo final: total / faturamento agregado das novas + links de revisão por linha
- **Botão novo "Upload em lote"** no `ListaView` ao lado do "Importar NF-e" single

- **`gastao-app/scripts/convert-criminal.mjs`** (commitado em 2026-05-27, dia de hoje) — conversor pro formato CRIMINAL com auto-ref renomeada `(in natura)`, unidade canônica por família majoritária, ficha→ficha suportada

### Infraestrutura

- **Bucket `nfe-xml` criado no Supabase Storage** (privado)
- **3 policies criadas** em `storage.objects`:
  - `nfe_xml_authenticated_insert` (authenticated, INSERT, check bucket_id)
  - `nfe_xml_authenticated_select` (authenticated, SELECT, using bucket_id)
  - `nfe_xml_authenticated_delete` (authenticated, DELETE, using bucket_id)
- **Vercel CLI autenticado no servidor Armazém** como `diegodsbernardi` (token permanente em `~/.vercel/`)
- **gastao-app/ linkado ao projeto Vercel** `diegodsbernardis-projects/gastao-app`
- **Deploy prod feito:** `dpl_HJ77Gm5w1TfyoL5VidX7UPgMEksu`, aliases atualizados:
  - `gastao-app-diegodsbernardis-projects.vercel.app`
  - `gastao-app-diegodsbernardi-diegodsbernardis-projects.vercel.app`

### Documentação + roadmap

- **`docs/ROADMAP.md`** (force-add em commit de 2026-05-26) — roadmap durável com 7 marcos, métricas de velocidade, decisões fechadas. Atualizar conforme features fecham.
- **`roadmap-site/`** — site visual Vite + React + Tailwind, single-page que lê `src/data.ts`. **Buildou local mas ainda não foi deployado no Vercel.** Quando deployar: `cd roadmap-site && vercel link --yes && vercel --prod --yes` (vai criar projeto novo).

---

## Estado do roadmap (em números)

| Marco | Status | Itens fechados | % |
|---|---|---|---|
| 1 — BRUT demo | ✅ Done | 9/9 | 100% |
| 2 — CRIMINAL demo | ✅ Done | 10/10 | 100% |
| 3 — NFe Bulk | 🟡 Em progresso | **4/9** | **44%** |
| 4 — Painel BPO | 🔵 Próximo | 0/5 | — |
| 5 — Robustez | 🟣 Backlog | 0/5 | — |
| 6 — SEFAZ | 🔴 Futuro | 0/4 | — |
| 7 — Estoque | 🔴 Futuro | 0/5 | — |

**Itens do Marco 3 ainda pendentes:**
- Migrar `match-nfe-items` de OpenAI gpt-4o-mini → Claude (Haiku/Sonnet) com prompt caching
- Extração de embalagem + qty canônica (resolve o caso "bacon 1kg vs 1,2kg")
- Cache local de mapeamentos (fornecedor_cnpj + descrição → insumo_confirmado_id)
- Atualização de `avg_cost_per_unit` pelo último/médio preço
- Teste end-to-end com 5-10 XMLs reais (50 disponíveis na pasta NotasEntrada da Dani)

---

## Estado técnico

### Repo
- Branch: `master`
- Último commit: `3fe2f9a feat(nfe): upload em lote de XMLs com dedup client-side`
- Tudo sincronizado com `origin/master`

### Recursos externos atualmente configurados
- **Vercel CLI:** logado como `diegodsbernardi` (persistente)
- **Google Drive integrado** ao Claude — pasta de trabalho `CINCO TECH - GASTÃO APP / Criminal /`
- **Subpasta `NotasEntrada/`** — 50 XMLs da Dani (`contabil.cincobpo@gmail.com`), datas 01/05 a 23/05/2026
- **Supabase prod** `hvnxvqycvnwquugnygzf` — bucket `nfe-xml` agora existe
- **Edge functions** `parse-nfe` e `match-nfe-items` — ainda na versão original com OpenAI gpt-4o-mini

### Tenant CRIMINAL no banco
- 1 restaurante (CRIMINAL BURGER)
- 145 insumos, 16 preparos, 48 fichas, 299 composições
- 17 fichas precificadas via cardápio
- 250 vendas inseridas (maio/2026, R$ 108k)
- 0 NFes ainda (vai ser primeiro teste do BulkUpload)

---

## Como continuar

### Quando voltar do paralelo

Primeira mensagem:

> "Lê `docs/specs/2026-05-29-handoff-nfe-bulk-mid.md`. Quero retomar o Marco 3 — começa pelo teste do BulkUpload com XMLs reais."

### Sequência ideal (~4h pra fechar Marco 3 todo)

1. **Teste do BulkUpload** (~15 min)
   - Diego baixa 3-5 XMLs da pasta NotasEntrada
   - Sobe via "Upload em lote" no app
   - Valida progress, dedup, links de revisão
   - Identifica bugs visuais se houver
   - Marca como concluído no `data.ts` do roadmap-site quando passar
2. **Migração OpenAI → Claude** (~1h)
   - Trocar fetch pra `api.anthropic.com/v1/messages`
   - Modelo `claude-haiku-4-5-20251001` (mais barato) — possível upgrade pra Sonnet 4.6 se confiança baixar
   - Adicionar **prompt caching** com `cache_control` no system + no catálogo de insumos (cache 5 min, reduz 80% custo em uploads consecutivos)
   - Setar `ANTHROPIC_API_KEY` no Supabase: dashboard → Edge Functions → Secrets
3. **Cálculo de embalagem** (~1h)
   - Aumentar prompt pra IA também retornar `embalagem_qty`, `embalagem_unidade`, `qty_total_canonica`, `preco_unitario_canonico`
   - Parse-nfe não precisa mexer (o XML já tem qCom/uCom; a IA extrai embalagem do `xProd` quando vier descritivo)
   - Calcular `preco_unitario_canonico = valor_total / qty_total_canonica` no app antes de salvar
4. **Cache local** (~30 min)
   - Antes de chamar IA, query: `SELECT insumo_confirmado_id FROM nfe_itens JOIN notas_fiscais ON ... WHERE descricao ILIKE X AND fornecedor_cnpj = Y LIMIT 1`
   - Se achou match confirmado anterior → usa direto
   - Senão → IA decide
   - Efeito: primeira NFe do Fornecedor X = IA. Próximas com mesmo CNPJ + descrição já sugerem instantâneo.
5. **Atualização de `avg_cost_per_unit`** (~30 min)
   - Quando item da NFe é confirmado (manualmente ou auto via cache), update `ingredients.avg_cost_per_unit` com o `preco_unitario_canonico` extraído
   - Política: "último wins" inicialmente (depois pode virar média móvel)
6. **Teste end-to-end com batch completo** (~30 min)
   - 50 XMLs reais
   - Confirma matches manuais nos primeiros 5-10
   - Próximos já sugerem via cache

### Quando voltar do paralelo, primeira ação concreta

Confirmar que o bucket realmente funciona — baixar 1 XML do Drive, abrir o app e tentar Upload single. Se passar, segue pro lote.

---

## Decisões abertas (perguntar ao Diego se ele lembrar)

- O **deploy do `roadmap-site/`** no Vercel — adia ou faz agora antes do Marco 3 fechar?
- Modelo Claude pra matcher: começar **Haiku** (mais barato, ~$0.001/NFe estimado) ou **Sonnet** (mais preciso, ~$0.005/NFe)?
- Política de atualização do `avg_cost_per_unit`: último wins, média móvel, ou só atualizar quando humano confirmar?

---

**Quando voltar, primeiro arquivo a abrir:** `docs/ROADMAP.md` pra ver tabela visual atualizada, depois esse handoff.
