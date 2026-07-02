# Handoff — NFe upload destravado + unidade tributável (2026-06-02)

**Status:** Upload de NF-e funcionando end-to-end em prod. Conversão caixa→kg implementada no backend e na tela. Falta deploy do front e o próximo passo (custo do insumo).

---

## O que estava quebrado: "notas não sobem / Failed to fetch"

Causa raiz (depois de descartar a pista falsa das env vars do Vercel — estavam íntegras):

- O upload (`src/lib/nfe.ts`) faz 3 passos: Storage → `parse-nfe` → `match-nfe-items`.
- **`match-nfe-items` nunca tinha sido deployada** no Supabase (só commitada). Endpoint dava 404, inclusive no preflight `OPTIONS`. **Preflight 404 → o navegador reporta `TypeError: Failed to fetch`.**

### Fixes aplicados (já em prod)

1. **`match-nfe-items` migrada OpenAI → Claude** (`claude-haiku-4-5-20251001`) com **prompt caching** (instruções + catálogo de insumos no system com `cache_control`). Usa `ANTHROPIC_API_KEY` que já estava nos secrets. Deployada.
2. **Bug de schema recorrente:** a coluna real em `ingredients` é **`tipo`** (pt), mas o código referenciava **`type`** (en) em 3 lugares:
   - `match-nfe-items/index.ts` (select + interface + uso) — corrigido
   - `NotasFiscais.tsx` linha ~950 (select do front) — corrigido. Era a causa do "Insumo sugerido: —" (a query quebrava, mapa de nomes vinha vazio).
   - ⚠️ ainda existe `type` em `CriarInsumoData` (`src/lib/nfe.ts`) e na interface local — checar se é o mesmo problema ao mexer em criação de insumo.
3. `parse-nfe` já estava ok (reescrito com fast-xml-parser; Deno não tem DOMParser).

---

## Unidade tributável (caixa → kg) — IMPLEMENTADO no backend + tela

Descoberta: **a NF-e já traz o peso real**. Cada item tem dois pares de unidade:
- Comercial: `uCom`/`qCom`/`vUnCom` (ex: "2 CX")
- **Tributável: `uTrib`/`qTrib`/`vUnTrib` (ex: "20,03 KG @ R$ 25,68/kg")**

Não precisa de IA pra adivinhar peso nem cadastro manual — é padrão SEFAZ.

### Feito
- `parse-nfe`: passa a extrair `qTrib`/`uTrib`/`vUnTrib` (fallback pro comercial se ausente). **Deployado e validado.**
- Migration `019_nfe_unidade_tributavel.sql`: 3 colunas em `nfe_itens` (`quantidade_tributavel`, `unidade_tributavel`, `valor_unitario_tributavel`). **Aplicada no banco.**
- `nfe.ts`: grava os campos ao inserir itens.
- `NotasFiscais.tsx`: helper `temConversao()` + exibe "= 20,03 KG · R$ 25,68/KG" (desktop e mobile) quando a tributável difere da comercial.
- Typecheck limpo (`tsc --noEmit` exit 0).

### Falta
- **Deploy do front (Vercel)** pra a tela aparecer. (Comando "deploy" do Diego.)
- A nota já subida foi parseada ANTES do fix → não tem os campos. Re-subir o XML pra ver a conversão.

---

## PRÓXIMO PASSO (decidido pelo Diego, NÃO implementado ainda)

Atualização de custo do insumo ao confirmar item:
- **Custo efetivo = último wins** (preço/unidade-canônica da nota mais recente confirmada).
- **+ Painel mostrando a média móvel dos últimos meses** por insumo (acompanhar tendência de preço). Definir onde mora esse painel (tela do insumo? dashboard?).
- Converter unidade: `uTrib` (KG) → `unit_type` do insumo (g) = ×1000. Cuidar de casos onde uTrib ≠ unidade da ficha (ex: UN).
- Considerar também: cache de mapeamento (fornecedor_cnpj + descrição → insumo_id) pra auto-sugerir sem chamar IA de novo.

---

## Estado do código (não commitado)

Modificados, prontos pra commit + deploy:
- `gastao-app/supabase/functions/match-nfe-items/index.ts`
- `gastao-app/supabase/functions/parse-nfe/index.ts`
- `gastao-app/supabase/migrations/019_nfe_unidade_tributavel.sql` (novo)
- `gastao-app/src/lib/nfe.ts`
- `gastao-app/src/pages/NotasFiscais.tsx`

(A `017_bpo_multi_restaurante.sql` aparece modificada de antes — não foi tocada nesta sessão.)
