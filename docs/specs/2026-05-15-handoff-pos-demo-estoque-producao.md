# Handoff — Pós-demo: estoque de produção (preparos + insumos)

**Data:** 2026-05-14 (quarta noite)
**De:** Diego + Claude (Windows local)
**Pra:** Diego + Claude (terminal do Armazém)
**Status:** Demo BRUT acontece sexta. Esse handoff é pra começar **logo após a demo** o desenvolvimento de uma feature âncora: **estoque de produção de preparos**.

---

## TL;DR

Hoje o Gastão calcula CMV teórico bem. Falta **operação real de cozinha**: chef produz batches de preparo, baixa do estoque na hora da produção, depois deduz por venda.

**Diego corrigiu o modelo (importante, releia abaixo):**
> Cascata acontece SÓ NA PRODUÇÃO, não na venda. Quando vende Filé com aligot, deduz 200g do estoque de Aligot pronto, **não** os ingredientes do Aligot. Os ingredientes do Aligot já foram deduzidos quando o chef produziu o Aligot lá atrás.

**Feature âncora** pra venda B2B2B via Cinco — nenhum competidor (Saipos, Konclui, Apicbase) faz isso direito pra sub-receita.

**Esforço estimado: 10-14h** distribuído em 5-7 dias.

---

## Modelo conceitual (releia antes de codar)

### Estado real da cozinha
- Insumos comprados ficam na **despensa** (batata, sal, mussarela, etc.)
- Chef pega da despensa pra **produzir batches de preparo** (20kg de Aligot, 5L de molho)
- Preparos prontos ficam na **geladeira/frigobar** (pote de Aligot, balde de Mel trufado, etc.)
- Garçom vende prato → cozinha monta usando preparos prontos + insumos diretos

### Modelo do sistema

**Evento 1 — PRODUÇÃO de preparo** (chef registra no app):

```
"Produzi 20 kg de Aligot"
  Aligot rende 2.520 g por batch normal
  20.000 g / 2.520 g = 7,94× a receita
  
  Deduz INSUMOS proporcionalmente:
    ─ batata: 2000g × 7,94 = 15.873 g    do estoque de insumo "batata"
    ─ sal:      20g × 7,94 =    158 g    do estoque de insumo "sal"
  
  Deduz PREPAROS-COMPONENTE direto:
    ─ Mix de queijos: 500g × 7,94 = 3.968 g    do estoque de preparo "Mix de queijos"
    (NÃO cascateia pra dentro do Mix — ele já tá pronto na geladeira)
  
  Adiciona:
    +20.000 g    no estoque de preparo "Aligot"
```

**Evento 2 — VENDA de ficha** (registrada no /sales):

```
"Cliente comprou 1 Filé a parmegiana"
  Composição da ficha:
    ─ Aligot: 150 g           →  deduz 150 g do ESTOQUE DE PREPARO Aligot
    ─ Molho de tomate: 100 g  →  deduz 100 g do ESTOQUE DE PREPARO Molho de tomate
    ─ Tomate confit: 50 g     →  deduz 50 g do ESTOQUE DE PREPARO Tomate confit
    ─ file empanado: 1 un     →  deduz 1 un do ESTOQUE DE INSUMO file empanado
    ─ queijo muçarela: 80 g   →  deduz 80 g do ESTOQUE DE INSUMO queijo muçarela
    ─ queijo parmesão: 20 g   →  deduz 20 g do ESTOQUE DE INSUMO queijo parmesão
  
  NÃO toca batata, sal, Mix de queijos. Esses já saíram lá no momento da produção do Aligot.
```

**A frase-resumo (cola no comentário do código):**
> "Cascata só na produção. Na venda, deduz só o nível direto."

---

## Schema de banco proposto

### Migration 017 — `stock_movements` unificada

```sql
-- Histórico de movimentos de estoque (insumos + preparos)
CREATE TABLE public.stock_movements (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id uuid NOT NULL REFERENCES public.restaurantes(id) ON DELETE CASCADE,
    
    -- O quê: insumo ou preparo?
    item_type text NOT NULL CHECK (item_type IN ('insumo', 'preparo')),
    item_id   uuid NOT NULL,  -- FK polimórfico (referencia ingredients.id OU recipes.id)
    
    -- Movimento
    tipo      text NOT NULL CHECK (tipo IN ('producao', 'venda', 'compra', 'perda', 'ajuste')),
    quantidade numeric NOT NULL,  -- positivo = entrada, negativo = saída
    unidade   text NOT NULL,      -- g | ml | un (canônica do item)
    
    -- Rastreabilidade
    sale_id        uuid REFERENCES public.sales(id) ON DELETE SET NULL,
    production_id  uuid REFERENCES public.productions(id) ON DELETE SET NULL,
    nfe_id         uuid REFERENCES public.notas_fiscais(id) ON DELETE SET NULL,
    motivo         text,
    user_id        uuid REFERENCES public.profiles(id),
    moved_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sm_restaurant_item ON public.stock_movements(restaurant_id, item_type, item_id);
CREATE INDEX idx_sm_moved_at ON public.stock_movements(moved_at DESC);

-- Tabela de "batches de produção" (cabeçalho — pra agrupar movimentos)
CREATE TABLE public.productions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id uuid NOT NULL REFERENCES public.restaurantes(id) ON DELETE CASCADE,
    recipe_id     uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
    quantidade    numeric NOT NULL,  -- na unidade canônica do preparo
    unidade       text NOT NULL,
    user_id       uuid REFERENCES public.profiles(id),
    notas         text,
    produced_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_prod_restaurant ON public.productions(restaurant_id, produced_at DESC);

-- View do estoque atual
CREATE VIEW public.current_stock AS
SELECT 
    restaurant_id,
    item_type,
    item_id,
    SUM(quantidade) AS quantidade_atual,
    MAX(unidade) AS unidade,
    MAX(moved_at) AS ultimo_movimento
FROM public.stock_movements
GROUP BY restaurant_id, item_type, item_id;

-- RLS
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productions ENABLE ROW LEVEL SECURITY;

-- Policies (igual padrão dos outros: filtra por restaurant_id via get_my_restaurant_id())
CREATE POLICY "sm_select" ON public.stock_movements
    FOR SELECT USING (restaurant_id = get_my_restaurant_id());
CREATE POLICY "sm_insert" ON public.stock_movements
    FOR INSERT WITH CHECK (restaurant_id = get_my_restaurant_id());

CREATE POLICY "prod_select" ON public.productions
    FOR SELECT USING (restaurant_id = get_my_restaurant_id());
CREATE POLICY "prod_insert" ON public.productions
    FOR INSERT WITH CHECK (restaurant_id = get_my_restaurant_id());
```

### Migração dos dados existentes

`ingredients.stock_quantity` já existe. Pra preservar:

```sql
-- Cria movimento inicial pra cada insumo com stock atual
INSERT INTO public.stock_movements (restaurant_id, item_type, item_id, tipo, quantidade, unidade, motivo, moved_at)
SELECT 
    restaurant_id,
    'insumo',
    id,
    'ajuste',
    stock_quantity,
    unit_type,
    'Migração v3 — estado inicial',
    now()
FROM public.ingredients
WHERE stock_quantity > 0;

-- (Opcional) Depois, remover stock_quantity de ingredients e usar só a view current_stock
-- ALTER TABLE public.ingredients DROP COLUMN stock_quantity;  -- só depois de validar
```

---

## Função Postgres: registrar produção (cascata)

```sql
-- Registra produção de preparo + deduz componentes
-- Retorna o production_id pro app rastrear
CREATE OR REPLACE FUNCTION public.register_production(
    p_recipe_id  uuid,
    p_quantidade numeric,
    p_unidade    text,
    p_notas      text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_restaurant_id uuid;
    v_recipe        RECORD;
    v_production_id uuid;
    v_factor        numeric;
    v_comp          RECORD;
BEGIN
    v_restaurant_id := public.get_my_restaurant_id();
    
    -- Carrega o preparo
    SELECT id, yield_quantity, unit_type INTO v_recipe
    FROM public.recipes 
    WHERE id = p_recipe_id AND restaurant_id = v_restaurant_id AND tipo = 'preparo';
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Preparo não encontrado';
    END IF;
    
    -- Fator de escala: quanto a produção é maior/menor que a receita padrão
    v_factor := p_quantidade / v_recipe.yield_quantity;
    
    -- Cria o batch de produção
    INSERT INTO public.productions (restaurant_id, recipe_id, quantidade, unidade, notas)
    VALUES (v_restaurant_id, p_recipe_id, p_quantidade, p_unidade, p_notas)
    RETURNING id INTO v_production_id;
    
    -- Deduz INSUMOS componentes (recipe_ingredients onde ingredient_id está preenchido)
    FOR v_comp IN
        SELECT ri.ingredient_id, ri.quantity_needed, i.unit_type
        FROM public.recipe_ingredients ri
        JOIN public.ingredients i ON i.id = ri.ingredient_id
        WHERE ri.recipe_id = p_recipe_id AND ri.ingredient_id IS NOT NULL
    LOOP
        INSERT INTO public.stock_movements 
            (restaurant_id, item_type, item_id, tipo, quantidade, unidade, production_id)
        VALUES (
            v_restaurant_id, 'insumo', v_comp.ingredient_id,
            'producao', -(v_comp.quantity_needed * v_factor), v_comp.unit_type,
            v_production_id
        );
    END LOOP;
    
    -- Deduz PREPAROS componentes (recipe_ingredients onde sub_recipe_id está preenchido)
    -- E TAMBÉM recipe_sub_recipes (nova tabela)
    FOR v_comp IN
        SELECT ri.sub_recipe_id AS sub_id, ri.quantity_needed, r.unit_type
        FROM public.recipe_ingredients ri
        JOIN public.recipes r ON r.id = ri.sub_recipe_id
        WHERE ri.recipe_id = p_recipe_id AND ri.sub_recipe_id IS NOT NULL
        UNION ALL
        SELECT rsr.sub_recipe_id, rsr.quantity_needed, r.unit_type
        FROM public.recipe_sub_recipes rsr
        JOIN public.recipes r ON r.id = rsr.sub_recipe_id
        WHERE rsr.recipe_id = p_recipe_id
    LOOP
        INSERT INTO public.stock_movements
            (restaurant_id, item_type, item_id, tipo, quantidade, unidade, production_id)
        VALUES (
            v_restaurant_id, 'preparo', v_comp.sub_id,
            'producao', -(v_comp.quantity_needed * v_factor), v_comp.unit_type,
            v_production_id
        );
    END LOOP;
    
    -- Adiciona o produto produzido ao estoque
    INSERT INTO public.stock_movements
        (restaurant_id, item_type, item_id, tipo, quantidade, unidade, production_id)
    VALUES (
        v_restaurant_id, 'preparo', p_recipe_id,
        'producao', p_quantidade, p_unidade,
        v_production_id
    );
    
    RETURN v_production_id;
END;
$$;
```

E uma versão similar pra `register_sale` (que deduz só os componentes DIRETOS da ficha, sem cascata).

---

## UI a fazer

### `/preparos` — cada card ganha bloco de estoque

```
┌──────────────────────────────────────────────────────────┐
│ Aligot                                                   │
│ Rende: 2.520 g            [Editar info]                  │
│ Usado em 2 receitas                                      │
│                                                          │
│ 📦 Estoque: 19.800 g (≈ 99 fichas)        🟢 Saudável   │
│                                                          │
│ Composição: ...                                          │
│                                                          │
│ [Registrar produção]                  [Editar composição]│
└──────────────────────────────────────────────────────────┘
```

### Modal "Registrar Produção"

```
┌─────────────────────────────────────────┐
│ Registrar produção de Aligot            │
├─────────────────────────────────────────┤
│ Quantidade: [20.000] g                  │
│                                         │
│ Isso vai consumir do estoque:           │
│   ─ batata: 15.873 g                    │
│   ─ sal: 158 g                          │
│   ─ Mix de queijos: 3.968 g (preparo)   │
│                                         │
│ E vai adicionar:                        │
│   + 20.000 g de Aligot                  │
│                                         │
│ Notas (opcional): [_____________]       │
│                                         │
│         [Cancelar] [Confirmar produção] │
└─────────────────────────────────────────┘
```

### Dashboard — widget "Estoque baixo"

```
┌─ ATENÇÃO: ESTOQUE BAIXO ─────────────────┐
│ 🔴 Mel trufado: 50 g (acaba em ~1 dia)   │
│ 🟡 Aligot: 1,2 kg (≈ 6 fichas)            │
│ 🟡 batata: 8 kg (~ 4 batches Aligot)     │
└───────────────────────────────────────────┘
```

### `/ingredients` — bloco análogo de estoque + histórico de entrada

(NFe já existe — pode integrar pra registrar entrada de insumos automaticamente)

---

## Ordem de implementação sugerida (10-14h dividida)

### Sprint 1 (~3h) — Infraestrutura
1. ✅ Criar migration 017 (`stock_movements` + `productions` + view + RLS) — 30min
2. ✅ Função `register_production` — 1h
3. ✅ Migração dos dados existentes (ingredients.stock_quantity → stock_movements) — 30min
4. ✅ Testar no Supabase Studio com fixture de Aligot/Mix de queijos — 1h

### Sprint 2 (~4h) — UI básica em /preparos
5. ✅ Bloco de estoque no card de preparo (lê de current_stock) — 1h
6. ✅ Modal "Registrar Produção" com preview de deduções — 2h
7. ✅ Hook na venda: ao inserir em `sales`, deduz componentes diretos via trigger ou app — 1h

### Sprint 3 (~3h) — Dashboard + alertas
8. ✅ Widget "Estoque baixo" no Dashboard — 1h
9. ✅ Configuração de estoque mínimo por preparo (campo novo em recipes) — 1h
10. ✅ Highlighting / sort por estoque baixo em /preparos — 1h

### Sprint 4 (~3h) — Refinamento + insumos
11. ✅ Bloco de estoque em /ingredients (igual /preparos) — 1h
12. ✅ Modal "Registrar Perda/Ajuste" pra todos itens — 1h
13. ✅ Histórico de movimentos (modal "Ver histórico") com filtros — 1h

### Sprint 5 (~1h) — Polimento
14. ✅ Trigger/lógica pra estoque negativo (alerta, não bloqueia) — 30min
15. ✅ Testes manuais com cenários reais do BRUT — 30min

---

## Edge cases a tratar

| Caso | Comportamento |
|---|---|
| Chef esquece de registrar produção, vende prato | Estoque negativo. Mostra 🔴 vermelho com "estoque inconsistente". Não bloqueia venda (cozinha tá fazendo mesmo assim). Chef vê e registra retroativo. |
| Chef registra produção mas não tem insumo o suficiente | Estoque de insumo vai negativo. Mesma resposta. Chef provavelmente comprou e esqueceu de registrar entrada. |
| Inventário físico não bate | Botão "Ajuste manual" registra a diferença com motivo (ex: "contagem mensal — perda 200g"). Não pergunta se quer cascatar. |
| Preparo perecível vence | Campo opcional `validade` em productions. Sistema avisa no dashboard quando próximo de vencer. |
| Refazer última produção (chef errou qty) | Modal "Editar última produção" desfaz movimentos anteriores e refaz. Audita via `motivo`. |
| Restaurante não usa estoque ainda | Feature é opt-in. Configuração por restaurante: `estoque_ativo: false` esconde toda UI de estoque. |

---

## Pegadinhas técnicas (não esquece)

1. **Unidades canônicas**: stock_movements.unidade é a canônica (g/ml/un). Ao deduzir, garante conversão (kg → g, l → ml) antes de gravar.
2. **Preparo composto de preparo composto**: ao produzir Aligot, deduz Mix de queijos (1 nível). NÃO desce pra dentro de Mix de queijos. Se o chef quer Aligot mas não tem Mix pronto, ele tem que produzir Mix primeiro (em ordem).
3. **RLS rigoroso**: stock_movements + productions só veem o próprio restaurant_id. Funções com `SECURITY DEFINER` se precisar acessar via cascata.
4. **Trigger automático ou app-level?**: vendas atuais já têm "Deduct stock for each ingredient" no `Sales.tsx` (vimos ontem). Refatorar pra:
   - Deduzir só componentes DIRETOS da ficha (não cascata)
   - Diferenciar insumo vs preparo (cada um sai do estoque correspondente)
5. **Performance**: view `current_stock` agrega `stock_movements` — pode ficar lenta com 100k+ movimentos. Considerar materialized view + refresh periódico se preciso. Por enquanto não, mas anota.

---

## Demo BRUT pitch — incluir esse roadmap

Na demo sexta, quando falar de "próxima fase":

> "E uma feature que vamos lançar nas próximas semanas é o **estoque de produção**. Hoje vocês já têm a ficha técnica com CMV teórico. Próxima camada: chef registra 'fiz 20kg de Maionese hoje' → sistema baixa azeite/sal/ovo do estoque de insumos e enche o estoque da Maionese. Conforme as vendas saem, deduz proporcional. Vocês olham no dashboard de manhã e veem 'Aligot acaba em 6 pratos, precisa produzir hoje'. Saipos não tem isso, Konclui não tem isso. **Mira específica em operação de cozinha**, não só gestão de cardápio."

---

## Como começar amanhã

```bash
cd <repo>
git pull
claude
```

Primeira mensagem (após demo BRUT terminar):

> "Lê `docs/specs/2026-05-15-handoff-pos-demo-estoque-producao.md`. Demo da BRUT foi [bom/regular/teve problema X]. Vamos começar Sprint 1 da feature de estoque: cria a migration 017 e a função register_production. Depois me passa SQL pra eu rodar no Supabase Studio e validar com fixture do Aligot/Mix de queijos."

Claude no terminal vai ter:
- Esse handoff (modelo conceitual + SQL + UI + sprints)
- Handoffs anteriores (demo, template v3, B2B2B Cinco)
- MEMORY.md
- Git log

Suficiente pra começar sem mais perguntas.

---

**Boa demo amanhã. Esse handoff te garante que pós-sexta a gente já tá no próximo nível — operação de cozinha, não só gestão de cardápio.**
