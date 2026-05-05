# Handoff — Pivot B2B2B via BPO Cinco

**Data:** 2026-05-05
**De:** Diego + Claude (PC1)
**Pra:** Diego + Claude (PC2 — quem pegar essa sessão)
**Status:** decisão estratégica fechada, plano técnico precisa ser revisado

---

## TL;DR (leia antes de qualquer coisa)

Diego está no PC2 continuando essa conversa. **Não recomece do zero** — o roadmap mudou de direção em 2026-05-05.

**O que mudou:**
1. Diego percebeu que está num loop pragmático ("corrige bug, deploya, próximo") e quer parar pra discutir produto.
2. Mapeamos o mercado (Konclui é checklists, Saipos é PDV gigante, Apicbase/MarketMan são recipe-costing focado) e decidimos **caminho A** — nicho CMV avançado.
3. Mas as respostas dele revelaram algo melhor: a BRUT (cliente da apresentação) vem do **BPO da Cinco**. Isso desbloqueia um modelo **B2B2B** (vender pro BPO, não pro restaurante final), bem mais alinhado com a cabeça de agência dele ("entregar e cobrar pelo feito").
4. Caminho final: **A.1 — SaaS B2B2B via BPO contábil/gestão (Cinco como primeiro)**.

**O que precisa ser feito quando Diego responder:**
- Ele vai responder 3 perguntas finais sobre a Cinco (relação dele com ela, # restaurantes no BPO, modelo de pagamento preferido).
- Daí o Claude PC2 monta o **plano técnico revisado das próximas 12-14h**, focado em B2B2B (painel BPO, white-label leve, onboarding assistido, NFe automática, mobile read-only).

**O que NÃO fazer:**
- Não codar signup self-service / Stripe / landing page B2C — esse caminho foi descartado.
- Não recomeçar a análise de mercado — está feita acima.
- Não terminar o conversor BRUT antes de Diego confirmar que ainda quer entregar pra apresentação.

---

## Estado técnico do repo (2026-05-05 manhã)

**Branch:** `master`, sincronizada com origin (até este commit).

**Últimos commits relevantes:**
```
e080c48 feat(preparos,recipes): filtro por categoria + sort por CMV
c559554 feat(combos): fichas podem conter outras fichas como sub-itens
e4b2c41 chore: gitignore data files + scripts da planilha legada do TOCS
c1b9b8b feat(categorias): governar categorias de preparos/fichas via tabela
cfe3c7b fix(importador): unificar fluxo /importar + preparo→preparo na tabela certa
```

**Deploys recentes em prod:**
- 2026-05-04 manhã: `dpl_HcH5UJBgEhuhD4QXCQXf1WoBYEsV` (Dia 1 — categorias governadas + smoke convite passou)
- 2026-05-04 tarde: `dpl_H8NeDbybZUq32c8wEtxuzEj7miEu` (Dia 2 — combos + sort CMV + filtro Preparos)

**Banco prod (`hvnxvqycvnwquugnygzf`):**
- Migration 016 (`recipe_categories`) rodada, validada
- Smoke E2E do convite passou (criar restaurante → convite → aceite → cleanup)
- Migrations 014/015 (RLS hardening + índices FK) já estavam OK
- ⚠ Projeto está em **free tier — pausa por inatividade**. Se a primeira query der timeout: `POST https://api.supabase.com/v1/projects/hvnxvqycvnwquugnygzf/restore` com PAT, e poll status até `ACTIVE_HEALTHY` (~3 min).

**CLI Supabase está logado em `diegodsbernardi@gmail.com`, mas o projeto Gastão pertence a `tocsbs@gmail.com`.** Pra rodar SQL via Management API, precisa de PAT novo (gerar em Account/Tokens com a conta tocsbs). Diego me passou um PAT na sessão Dia 1, eu apaguei do disco depois. Vai precisar de um novo se for tocar no banco prod.

---

## Análise estratégica (resumo do que conversamos)

### Mercado em 1 parágrafo
**Saipos** domina (18-25k restaurantes, R$220+/mês, faz PDV+delivery+ficha+NFC-e+iFood). **Sischef, BeeFood, Food Sistemas** são clones de Saipos. **Konclui** (2.500+ restaurantes) NÃO é competidor — eles fazem **checklists inteligentes** com app mobile pra equipe, CMV/ficha técnica é só conteúdo de blog. **Apicbase e MarketMan** (internacionais, US$ 99-299/mês) são a referência de positioning de "recipe costing focado" — categoria que existe globalmente e tem espaço no Brasil.

### Diagnóstico Gastão hoje

**Tem (técnico):** ficha recursiva 3 camadas + CMV cascata, importador IA + planilha-mãe v2, combos ficha→ficha, NFe XML upload + matching IA, multi-tenant RLS hardened, checklists, feedbacks.

**Não tem (produto):** signup self-service, billing/cobrança, plano free vs pago, marketing site, onboarding guiado, mobile/PWA, NFe automática SEFAZ, LGPD/termos, suporte, métricas internas, integração iFood/PDV.

**Veredito honesto:** **Gastão é uma ferramenta técnica boa, NÃO é um SaaS funcional.** Falta o caminho do dinheiro inteiro.

### Persona confirmada por Diego

> "é o pequeno que tá em crescimento, saiu do 'sou chef de cozinha' pra se afastar um pouco e ver que a operação precisa de gestão. eu queria focar em hambúrguer porém temos clientes de todos os nichos então temos que atender"

**Insights:**
- Janela de vida do cliente: **6-18 meses** (chef-novato-em-gestão → quando vira "rede" migra pra Saipos)
- Multi-segmento por necessidade comercial — a Planilha-Mãe v2 já é multi-segmento (foi por isso que insistimos em remover hardcoded "Lanche/Combo")
- Não conhece tecnologia profunda → onboarding guiado é crítico

### Sinais que Diego deu sem perceber

**Sinal 1 — métrica de agência, não de SaaS:**
> "eu n sei. eu quero ter algo legal pra pelo menos entregar e poder cobrar por ter feito ele"

Ele NÃO está pensando em MRR/retention/churn. Está pensando em **projeto entregue + valor cobrado**. Mentalidade de consultoria/agência, não SaaS B2C. Isso é dado, não problema — só precisa nomear pra calibrar tudo.

**Sinal 2 — o canal já existe:**
> "a brut é uma venda/favor. eles já são clientes do BPO da Cinco e querem o gastão na operação"

A BRUT não é cold lead. Veio através da **Cinco (BPO contábil/gestão)**. Esse é o pattern de aquisição **B2B2B via parceiro contábil**, exatamente como Conta Azul / Omie / Granatum cresceram nos primeiros anos.

### Caminho escolhido: A.1 — SaaS B2B2B via BPO

**Modelo:**
- **Quem paga:** Cinco (BPO), não restaurante final
- **Quem onboarda:** Cinco importa planilha do cliente, cadastra usuários
- **Quem dá suporte:** Cinco em 1ª linha, Diego em 2ª linha técnica
- **Pricing exemplo:** R$ 79-149/mês por restaurante embutido no pacote BPO. Cinco cobra cliente final R$ 200-400, fica com a margem.

**Por que isso resolve a maioria dos problemas:**
1. **Não precisa** de signup self-service, landing pública, Stripe sofisticado, marketing — vende pra 1 BPO de cada vez via conversa direta
2. **Persona já filtrada** pelo BPO (clientes do BPO = pequenos em crescimento + abertos a tecnologia)
3. **Multi-segmento resolvido** (BPO atende todos)
4. **Métrica clara em 90 dias:** 1 BPO ativo (Cinco) + 5-10 restaurantes onboarded + 1 case formalizado
5. **Cabe no "ter algo pra entregar e cobrar"** — primeiro contrato com Cinco é setup pago + recorrência por unidade

---

## Perguntas pendentes (Diego responde no PC2)

1. **A Cinco é tua empresa, sócio teu, ou cliente teu?** Muda quem assina o contrato Gastão↔Cinco.
2. **Quantos restaurantes tem hoje no BPO da Cinco?** Define o tamanho do piloto possível e o TAM imediato.
3. **A Cinco topa pagar mensalidade por restaurante (modelo SaaS) ou prefere pagar 1x por setup + manutenção (modelo agência)?** Define o modelo financeiro.

---

## Plano técnico das próximas 12-14h (B2B2B-focused)

**Sai do plano original (B2C):** signup self-service, landing pública com pricing, Stripe.

**Entra no plano B2B2B:**

1. **Conversa formal com a Cinco** (Diego, fora do código). Definir preço, comissão, SLA, suporte, contrato.

2. **Painel de BPO** (~3-4h código): tela onde a Cinco cria restaurantes, cadastra contadores como admin de cada um, vê todos clientes num lugar só (multi-restaurante view). Hoje cada restaurante é silo completo.

3. **White-label leve** (~1-2h): coluna em `restaurantes` ou nova tabela `bpos` pra logo + cor primária. "Powered by Gastão" no rodapé.

4. **Onboarding assistido** (~2-3h): tela onde Cinco sobe planilha do novo restaurante e valida em 1 clique. Planilha-mãe + importador atual já fazem 80% — falta só wrapper de UX.

5. **NFe automática SEFAZ Fase 1** (~4-6h, separado): Diego prometeu na apresentação anterior. Diferencial real vs Saipos pro BPO ("seu cliente nem sobe XML"). Provider B (Arquivei/FocusNFe) — ver spec [2026-04-23-apresentacao-e-sefaz-roadmap-design.md](2026-04-23-apresentacao-e-sefaz-roadmap-design.md).

6. **Mobile read-only / PWA** (~2-3h): dono do restaurante vê dashboard, fichas, CMV no celular. Mantém "stickiness" do cliente final mesmo que BPO opere.

**Total estimado:** 12-18h código + tempo de Diego pra negociação Cinco (fora de código).

---

## Conversor BRUT (apresentação que estava agendada)

**Status:** WIP. Coquetéis funcionam (15 drinks parseados, custo correto, preço sugerido CMV 25%). Food parser tem 3 bugs conhecidos — última run produziu **0 preparos / 0 fichas food**.

**Bugs documentados no header de [convert-brut.mjs](../../gastao-app/scripts/convert-brut.mjs):**
1. Nome do preparo/ficha está em `header[5]`, não `header[4]`
2. Header "INGREDIENTES" está em col 2, não col 1
3. parseEstoque está extraindo "Nome da Receita" como insumo (centenas de linhas) — adicionar à lista de skip

**Tempo pra fechar:** ~1h.

**Decisão pendente:** Diego ainda quer entregar pra BRUT? Se sim, terminar antes de qualquer coisa B2B2B (apresentação tem prazo). Se não, pular pro plano B2B2B direto e renegociar BRUT pelo canal Cinco.

**Inputs originais:** `gastao-app/fichas brut/` (gitignored — Diego copia manual no PC2 se for terminar).

---

## Como continuar no PC2 (instruções pro Claude lá)

1. **Lê esse handoff inteiro primeiro.** Não chuta o que aconteceu — leia.
2. **Lê o memory** em `~/.claude/projects/C--Users-usuario-Desktop-IA-Gastao/memory/` — especialmente `project_gastao_state_2026_05_04.md` (Dias 1+2). Vou atualizar isso pra apontar pra esse handoff.
3. **Pergunta ao Diego:** "Vamos pelas 3 perguntas pendentes da Cinco ou você já tem as respostas?"
4. **Quando ele responder:** monta o plano técnico revisado das 12-14h (esqueleto está acima, refina com base nas respostas).
5. **Sobre o conversor BRUT:** pergunta se ainda é prioridade ou se BRUT vai virar o 1º case do canal Cinco.
6. **Não prometa o que não dá pra entregar.** Tipo: "vou ter signup self-service + Stripe + landing em 12h" — não é realista nem é o caminho.

---

## Arquivos-chave pra ter na cabeça

- [docs/specs/2026-04-23-apresentacao-e-sefaz-roadmap-design.md](2026-04-23-apresentacao-e-sefaz-roadmap-design.md) — spec da apresentação anterior + design SEFAZ Fase 1
- [gastao-app/src/lib/gastaoTemplate.ts](../../gastao-app/src/lib/gastaoTemplate.ts) — parser da Planilha-Mãe v2 (combos suportado desde commit c559554)
- [gastao-app/src/lib/costCalculator.ts](../../gastao-app/src/lib/costCalculator.ts) — recursão de custo (genérica, suporta combos)
- [gastao-app/src/components/ExcelImporter.tsx](../../gastao-app/src/components/ExcelImporter.tsx) — importador (categorias governadas + ficha→ficha)
- [gastao-app/src/pages/Recipes.tsx](../../gastao-app/src/pages/Recipes.tsx) — UI fichas (sort CMV + badge combo + unifiedCostMap)
- [gastao-app/src/pages/Preparos.tsx](../../gastao-app/src/pages/Preparos.tsx) — UI preparos (filtro por categoria)
- [gastao-app/scripts/convert-brut.mjs](../../gastao-app/scripts/convert-brut.mjs) — conversor BRUT (WIP, bugs no header)
- [gastao-app/scripts/generate-template.mjs](../../gastao-app/scripts/generate-template.mjs) — gerador da Planilha-Mãe (named ranges + combos)

---

**Boa, Diego. Quando você abrir no PC2, primeira mensagem ali:**
> "Claude, lê `docs/specs/2026-05-05-handoff-pivot-b2b2b-cinco.md` e me diz o que tá faltando pra continuar."
