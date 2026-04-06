# GASTÃO — Receitas

Use the Paper MCP to create a mockup of the GASTÃO Receitas (sub-recipes) screen in a new artboard in https://app.paper.design/file/01KNHN04GEB9YHSX4JNKRGKDRB

## SETUP
- Create a new artboard named "05 — Receitas"
- Dimensions: 1440 × 900px
- Same palette and sidebar structure
- "Receitas" active in sidebar

## LAYOUT

### LEFT SIDEBAR (240px) — same as Dashboard, "Receitas" nav item active

### MAIN CONTENT (flex: 1, padding 32px, background #F0F7FF)

#### TOP BAR
- Left: "Receitas" — 28px, bold, #1A1A2E
- Below: "Componentes e sub-receitas usados nos produtos finais" — 14px, #64748B
- Right: "+ Nova Receita" button — teal bg, white text, border-radius 8px

#### FILTER BAR (margin-top 24px, flex row, gap 12px)
- Search input: 320px wide, border 1.5px solid #E2E8F0, border-radius 8px, placeholder "Buscar receita...", search icon left
- Category dropdown: "Todas as categorias ▾" — border #E2E8F0, border-radius 8px, 180px
- Sort: "Ordenar por ▾" — same style

#### RECIPE CARDS GRID (3 columns, gap 20px, margin-top 24px)
Each card: white bg, border-radius 12px, overflow hidden, shadow 0 2px 8px rgba(0,0,0,0.05), hover: shadow increases

1. **Maionese da Casa**
   - Top: placeholder image area (200px tall, bg #F1F5F9, centered food icon)
   - Body (padding 20px):
   - Category tag: "MOLHOS" — pill, bg #FEF3C7, text #92400E, 11px
   - Title: "Maionese da Casa" — 16px bold, #1A1A2E
   - Row: "Rendimento: 2kg" — 13px, #64748B | "Custo: R$ 12,40/kg" — 13px, #00B4D8 bold
   - Bottom: "Atualizado há 3 dias" — 12px, #94A3B8

2. **Hambúrguer Artesanal (un)**
   - Tag: "PROTEÍNAS" — bg #DCFCE7, text #166534
   - Title: "Hambúrguer Artesanal"
   - "Rendimento: 20 unidades" | "Custo: R$ 3,50/un"
   - "Atualizado há 1 dia"

3. **Molho Especial BBQ**
   - Tag: "MOLHOS"
   - Title: "Molho Especial BBQ"
   - "Rendimento: 1,5kg" | "Custo: R$ 18,00/kg"

4. **Pão Brioche**
   - Tag: "BASES" — bg #E0E7FF, text #3730A3
   - Title: "Pão Brioche"
   - "Rendimento: 30 unidades" | "Custo: R$ 1,20/un"

5. **Cebola Caramelizada**
   - Tag: "ACOMPANHAMENTOS" — bg #FCE7F3, text #9D174D
   - Title: "Cebola Caramelizada"
   - "Rendimento: 3kg" | "Custo: R$ 8,50/kg"

6. **Bacon Crocante**
   - Tag: "PROTEÍNAS"
   - Title: "Bacon Crocante"
   - "Rendimento: 2kg" | "Custo: R$ 45,00/kg"

#### SUMMARY BAR (bottom of page or below grid)
- Light card (bg #FFFFFF, border-radius 12px, padding 16px 24px, flex row space-between)
- "Total de Receitas: 12" | "Categorias: 5" | "Custo Médio: R$ 14,80/kg" | "Última atualização: hoje"

## STYLE RULES
- Recipe cards: image placeholder at top, content below
- Category tags: colored pills, soft bg + darker text
- Card hover: shadow 0 4px 16px rgba(0,0,0,0.1)
- Search input focus: border-color #00B4D8
- Grid: 3 equal columns for desktop

## OUTPUT
Write the full HTML + inline CSS to the Paper artboard using write_html.
