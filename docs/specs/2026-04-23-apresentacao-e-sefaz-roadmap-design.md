# Apresentação 14h 2026-04-23 + Roadmap SEFAZ automático

**Data:** 2026-04-23
**Autor:** Diego + Claude
**Público:** mescla de cliente-restaurante (usuário final) e time interno
**Formato:** demo ao vivo em prod, ~12 min de fala

---

## 1. Objetivo

Apresentar o estado atual do Gastão (fork do TOCS rebrandado) com foco em dor da cozinha — custo real, ficha técnica sem redigitar, rotina operacional — e deixar claro o próximo grande passo: NFe automática via SEFAZ.

## 2. Plano de preparação (9h → 14h)

| Horário | Atividade | Observação |
|---|---|---|
| 9:00–9:30 | Brainstorming / fechar spec | — |
| 9:30–10:30 | Popular conta prod: criar restaurante, importar `gastao_import_abril_2026.xlsx` | Se importador falhar, seed manual reduzido |
| 10:30–11:15 | Smoke test de todas as rotas; conferir Dashboard, CMV, sub-preparos | — |
| 11:15–12:00 | Subir 1–2 XMLs de NFe (fornecidos pelo Diego); criar 1 template de checklist + 1 run; registrar 1 feedback; lançar 5–8 vendas | — |
| 12:00–12:45 | Almoço | — |
| 12:45–13:30 | Ensaio cronometrado (2 passes) | — |
| 13:30–14:00 | Buffer; abas prontas; notificações desligadas | — |

**Risco-chave:** importação da planilha demorar/falhar. Plano B: seed reduzido de ~10 fichas manuais.

## 3. Checklist de dados pra popular

- [ ] Conta prod limpa (restaurante novo)
- [ ] Import da planilha `gastao_import_abril_2026.xlsx` (373 insumos / 122 preparos / 49 fichas)
- [ ] 5–8 vendas mistas em `/sales` (pra Dashboard exibir top-3 + CMV mensal)
- [ ] 1–2 NFes XML em `/notas-fiscais` (matching IA → confirmar → observar atualização de custo)
- [ ] 1 template de checklist "Fechamento de Cozinha" + 1 run preenchida
- [ ] 1 feedback de exemplo

## 4. Roteiro da demo (ordem e tempo)

Duração-alvo: 12 min. Tom: linguagem de cozinha, não de software.

1. **(1 min) Abertura** — "Gastão é o caderno da cozinha digital. Três promessas: saber o custo real do prato, importar ficha sem redigitar, acompanhar a rotina."
2. **(2 min) Dashboard (`/`)** — CMV mensal, top produtos, alertas de estoque. *"É o que o dono olha antes de abrir a loja."*
3. **(3 min) Ficha técnica recursiva (`/recipes`)** — entra numa ficha com sub-preparo (molho). *"Alterou preço do tomate, todos os molhos e todos os pratos que usam molho recalculam sozinhos."*
4. **(2 min) Importador Excel (`/importar`)** — sobe a planilha (ou mostra pré-importada). *"Ao invés de digitar 373 insumos, joga sua planilha."*
5. **(2 min) NFe + gancho SEFAZ (`/notas-fiscais`)** — sobe XML → matching IA → confirma → custo atualiza. *"Hoje você sobe o XML que o fornecedor manda. Em breve, puxamos direto do SEFAZ."*
6. **(1 min) Checklist + Feedback** — passada rápida. *"Rotina de cozinha e gestão de equipe."*
7. **(1 min) Roadmap** — SEFAZ automático, Planilha-Mãe v2 (qualquer segmento), app mobile/tablet.

## 5. Features a mostrar (inventário)

- `/` Dashboard — receita mensal, CMV%, top produtos, alertas
- `/ingredients` — insumos base / diretos / embalagens, import Excel
- `/preparos` — mini-receitas 3-layer (insumo → preparo → ficha)
- `/recipes` — fichas finais com custo recursivo
- `/importar` — agente IA para qualquer planilha Excel (Claude Haiku/Sonnet)
- `/sales` — log de vendas
- `/notas-fiscais` — upload XML, matching IA, confirmação atualiza `avg_cost`
- `/checklists` — templates (diário/semanal/mensal) + runs rastreáveis
- `/feedbacks` — avaliações 1:1 estruturadas
- `/equipe` — membros + convites multi-tenant (RLS hardened)

Módulo **CMV/custos**: `costCalculator.ts` com recursão memoizada e detecção de ciclos.

## 6. Roadmap SEFAZ automático — design de alto nível

### 6.1 Contexto do problema

O restaurante é **destinatário** de NFe (não emissor). Fornecedores emitem NFes contra o CNPJ dele. "Baixar automático" significa puxar, do SEFAZ, todos os XMLs emitidos contra o CNPJ desde o último puxe. Esse fluxo oficial chama-se **Manifestação do Destinatário (MD-e)** — serviço `NFeDistribuicaoDFe` da SEFAZ Nacional.

Hoje o fluxo do Gastão é manual: fornecedor envia XML, restaurante faz upload em `/notas-fiscais`, IA casa com insumos cadastrados, restaurante confirma, `confirmar_nfe()` atualiza estoque e custo médio ponderado.

### 6.2 Três abordagens avaliadas

| Abordagem | Como funciona | Custo | Complexidade dev | Tempo real de entrega |
|---|---|---|---|---|
| **A) Webservice SEFAZ direto** | Backend nosso chama `NFeDistribuicaoDFe` com certificado A1 do cliente; requer assinatura XML SOAP | ~R$200/ano de cert por CNPJ | Alta — SOAP, assinatura XMLDSig, crypto nativa, edge function não serve bem | 6-10 semanas |
| **B) API terceirizada** ⭐ (Arquivei, FocusNFe, Nfe.io, Plugg.to) | Cliente cadastra CNPJ+cert no portal do provider; Gastão chama REST simples e recebe XMLs já baixados | R$30-100/mês por CNPJ (repassado ou absorvido) | Baixa — REST + webhook | 2-4 semanas |
| **C) Email drop-box** | Gastão expõe `nfe+tenant_id@gastao.app`; fornecedor ou restaurante encaminha pra lá; app processa anexos | ~zero | Baixa-média — parse MIME + anti-spam | 1-2 semanas |
| ~~D) Scraping portal SEFAZ~~ | — | — | — | **descartado** (frágil, anti-automação, risco legal) |

### 6.3 Recomendação

**Fase 1 (MVP):** Abordagem **B** com um provider (sugestão: FocusNFe ou Arquivei — validar pricing e cobertura UF).
Razão: time-to-market em semanas, sem esforço de crypto/SOAP, UX do cliente é só colar um token no Gastão.

**Fase 2 (complementar):** Abordagem **C** (email) pra clientes menores ou fornecedores pontuais — custo zero, funciona como fallback.

**Fase 3 (futuro):** Abordagem **A** se ficar caro repassar o terceirizado (>R$1/CNPJ/dia) ou se o pricing do provider escalar ruim.

### 6.4 O que falar na reunião

> "A próxima etapa é o Gastão puxar as NFes sozinho. Vocês só vão precisar cadastrar o certificado digital uma vez. Estamos avaliando integrar via API de parceiro (Arquivei ou similar) para entregar nas próximas semanas."

Sem compromisso de data exata — medir esforço real antes.

### 6.5 Escopo fora deste spec

- Integração com provider específico (spec técnico separado após decisão)
- Fluxo de onboarding do certificado digital A1 (UX da tela)
- Política de retry / reconciliação de NFes já recebidas

## 7. Critério de sucesso (apresentação)

- Público entende em 1 frase o que é o Gastão
- Demo roda sem erro crítico (plano B pronto caso importador falhe)
- Público sai com a percepção de que NFe automática está no horizonte próximo
- Tempo total ≤ 15 min de fala

## 8. Pós-apresentação (não bloqueia hoje)

- Capturar perguntas/feedback da audiência em notas
- Se NFe automática virar prioridade confirmada → abrir spec técnico separado para integração com provider escolhido
- Atualizar memória com resultado da reunião

---

**Status:** aprovado para execução em 2026-04-23 09h30.
