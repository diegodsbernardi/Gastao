# Gastão — Roadmap de Execução

> **Como ler:** `[x]` = concluído, `[ ]` = pendente, `[~]` = em progresso. Atualizado conforme as features fecham.
> **Última atualização:** 2026-05-26

---

## 🏁 Marco 1 — Validação inicial (BRUT) ✅ FECHADO

Entrega: ferramenta com dados reais do primeiro cliente + demo executada.

- [x] Fork TOCS → Gastão (rebranding, paleta, tom de voz) — 2026-04-08
- [x] Conversor BRUT (3 abas → planilha-mãe v2) — 2026-05-13
- [x] Tenant BRUT em prod com 419 insumos / 17 preparos / 21 fichas — 2026-05-13
- [x] Vendas abril/2026 inseridas (R$ 58k, 14 fichas) — 2026-05-14
- [x] 6 fichas-âncora com CMV calculado (Bruschetta, Croqueta, Filé aligot, etc) — 2026-05-14
- [x] Roteiro de demo escrito (3 atos / duplo registro Vanessa/Dani) — 2026-05-14
- [x] Bugs do app corrigidos (cache entre rotas, sub-preparos cascata, multi-categoria, fmtMoney 4 decimais) — 2026-05-13/14
- [x] Planilha-mãe v3 chef-friendly gerada (10 abas, validação interna) — 2026-05-15
- [x] Demo BRUT executada — 2026-05-15

## 🏁 Marco 2 — Segundo cliente (CRIMINAL) ✅ FECHADO

Entrega: replicar BRUT em outro cliente do BPO Cinco, provando escalabilidade.

- [x] Planilhas CRIMINAL diagnosticadas (75 abas, 1 receita/aba, formato auto-contido) — 2026-05-19
- [x] Conversor CRIMINAL escrito (`convert-criminal.mjs`, ~600 linhas) — 2026-05-19
- [x] Bugs do conversor corrigidos (auto-ref `(in natura)`, unidade canônica por insumo via família majoritária, ficha→ficha em composição) — 2026-05-19
- [x] Tenant CRIMINAL em prod: 145 insumos / 16 preparos / 48 fichas / 299 composições — 2026-05-20
- [x] 17 fichas precificadas via cardápio PDF parseado — 2026-05-20
- [x] Vendas maio/2026 importadas: 3.277 transações → 250 linhas (data,ficha) — R$ 108.372 — 2026-05-20
- [x] Conversation point detectado e mantido (Batata CMV 80% por bug de cadastro da Maionese) — 2026-05-20
- [x] Smoke test passado (Dashboard, /recipes, sort por CMV, composição visível) — 2026-05-20
- [x] Demo CRIMINAL executada — 2026-05-20

## 🚧 Marco 3 — NFe Bulk (Cinco operando) 🟡 EM PROGRESSO

Entrega: Cinco BPO consegue subir múltiplos XMLs de NFe de uma vez pelo painel atual.

- [ ] [~] Componente `BulkUploadView` em `NotasFiscais.tsx` (multi-file select + drag de pasta) — **fazendo agora**
- [ ] Loop sequencial processando cada XML (parse → match IA → save) com progress visual
- [ ] Skip soft de duplicatas (numero_nota + fornecedor_cnpj + data_emissao já existem)
- [ ] Log final: X processados, Y duplicados, Z com erro (link pra cada review)
- [ ] Teste end-to-end com 5-10 XMLs reais quando Dani enviar
- [ ] Documentar caminho no app pro time da Cinco

**Estimativa:** 2-3h código + 1h teste com XMLs reais.

## 🔭 Marco 4 — B2B2B real (painel Cinco) 🔵 PRÓXIMO

Entrega: Cinco entra no Gastão e vê N restaurantes do BPO num lugar só, com isolamento.

- [ ] Perfil novo `bpo` em `membros.perfil` (N memberships, switch de contexto)
- [ ] Header global com dropdown "Restaurante ativo" pra usuários BPO
- [ ] RLS auditada pra garantir que `bpo` nunca bypassa policies cross-tenant
- [ ] White-label leve (logo + cor primária por BPO) em `restaurantes` ou tabela `bpos`
- [ ] Onboarding assistido — Cinco sobe planilha-mãe v3 do cliente novo + valida em 1 clique

**Estimativa:** 6-9h. Bloqueia escala — sem isso, Cinco opera N tenants logando em N contas.

## 🛡 Marco 5 — Robustez técnica 🟣 BACKLOG

Entrega: blindagens que evitam regressão e melhoram UX.

- [ ] **Importador atômico** — RPC com BEGIN/COMMIT, rollback automático em erro (hoje deixa preparos órfãos sem composição quando falha no meio)
- [ ] Cache invalidation entre rotas via React Query (resolve "pisca em branco" definitivamente)
- [ ] Alertas de CMV alto configurável por restaurante (threshold + cores)
- [ ] Adaptar `ExcelImporter.tsx` pra aceitar schema v3 (embalagem qtd + unidade)
- [ ] Refactor parser `gastaoTemplate.ts` por header name (vs posição) — blinda contra v4/v5

**Estimativa:** 4-6h.

## 🚀 Marco 6 — NFe automática SEFAZ 🔴 FUTURO

Entrega: NFe chega no Gastão sem ninguém precisar subir XML — provider busca direto na SEFAZ.

- [ ] Integração com Arquivei ou FocusNFe (avaliar custo/cobertura)
- [ ] Job agendado puxando NFe novas por CNPJ do restaurante
- [ ] Cron + dedup automático
- [ ] UI de "configurar provider" no painel BPO

**Estimativa:** 4-6h. Diferenciação real vs Saipos pro pitch comercial.

## 🚀 Marco 7 — Estoque de produção 🔴 FUTURO

Entrega: chef registra "produzi 20kg de Aligot" → sistema deduz insumos do estoque + adiciona ao estoque do preparo. Vendas deduzem preparo direto (não cascateia).

Spec completa em [2026-05-15-handoff-pos-demo-estoque-producao.md](specs/2026-05-15-handoff-pos-demo-estoque-producao.md).

- [ ] Migration 017 (`stock_movements` + `productions` + view `current_stock`)
- [ ] RPC `register_production(recipe_id, qty)` com cascata só na produção
- [ ] RPC `register_sale` deduzindo só componentes diretos (sem cascata)
- [ ] UI em `/preparos` — bloco de estoque + modal "Registrar produção"
- [ ] Dashboard widget "Estoque baixo"

**Estimativa:** 10-14h (5 sprints).

---

## 📊 Velocidade

| Marco | Itens | Esforço estimado | Esforço real | Janela calendário |
|---|---|---|---|---|
| 1 — BRUT demo | 9 | ~25h | ~25h | 2026-04-08 → 2026-05-15 (5 semanas, paralelo) |
| 2 — CRIMINAL demo | 10 | ~10h | ~10h | 2026-05-19 → 2026-05-20 (~28h corridas) |
| 3 — NFe bulk | 5 | 3-4h | — | 2026-05-26 → ? |
| 4 — Painel BPO | 5 | 6-9h | — | — |
| 5 — Robustez | 5 | 4-6h | — | — |
| 6 — SEFAZ | 4 | 4-6h | — | — |
| 7 — Estoque | 5 | 10-14h | — | — |

**Tempo total estimado restante até Marco 7:** ~30-40h código + tempo de negociação Cinco fora do código.

---

## 🎯 Decisões fechadas — não rediscutir

- ✅ B2B2B via BPO Cinco (não vai pra B2C self-service)
- ✅ Unidades canônicas g/ml/un (não kg/L)
- ✅ Stock-of-production: cascata só na produção, não na venda
- ✅ Template v3 mantém v2 ativo durante transição
- ✅ Pricing público fora da presença do cliente final
- ✅ Cinco vê N restaurantes via switch de contexto, RLS nunca bypassada
