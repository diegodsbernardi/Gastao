# GASTÃO — Checklists Templates

Use the Paper MCP to create a mockup of the GASTÃO Checklists Templates tab in a new artboard in https://app.paper.design/file/01KNHN04GEB9YHSX4JNKRGKDRB

## SETUP
- Create a new artboard named "04 — Checklists Templates"
- Dimensions: 1440 × 900px
- Same palette and sidebar as previous artboards
- "Checklists" active in sidebar

## LAYOUT

### LEFT SIDEBAR (240px) — same as Dashboard, "Checklists" active

### MAIN CONTENT (flex: 1, padding 32px, background #F0F7FF)

#### TOP BAR
- Left: "Checklists" — 28px, bold, #1A1A2E
- Right: "+ Novo Checklist" button — teal

#### TAB BAR
- 3 tabs: "Agendamentos" (inactive), "Executar" (inactive), "Templates" — **ACTIVE** (teal + underline)

#### HERO SECTION (margin-top 24px)
- Light teal pill badge at top: "⚡ COMECE RÁPIDO" — bg #E0F7FA, text #00B4D8, 12px bold, padding 6px 16px, border-radius 20px, centered
- Heading: "Checklists prontos. Crie o seu em minutos — ou deixe a IA criar" — 32px, bold, #1A1A2E, centered, max-width 700px, line-height 1.3
- Margin-bottom 32px

#### TOP ROW — 3 special cards (gap 20px, flex row)
Each card: white bg, border 1.5px solid #E2E8F0, border-radius 12px, padding 28px, flex: 1, hover: border-color #00B4D8

1. **Criar Novo**
   - Icon: "+" in 40px circle, border 2px dashed #E2E8F0
   - Title: "Criar Novo" — 16px bold, #1A1A2E
   - Description: "Crie um novo checklist sem usar um template" — 13px, #64748B
   - Link: "Usar esse template ▸" — 13px, #00B4D8, bold

2. **Criar com IA**
   - Icon: sparkle/star icon in 40px circle, bg #E0F7FA, icon #00B4D8
   - Title: "Criar com IA" — 16px bold
   - Description: "Crie um novo checklist usando nossa inteligência artificial"
   - Link: "Usar esse template ▸" — teal

3. **Template Padrão**
   - Icon: clipboard icon in 40px circle, bg #F0F7FF, icon #1B2A4A
   - Title: "Template Padrão" — 16px bold
   - Description: "Use como ponto de partida para criar qualquer checklist"
   - Link: "Usar esse template ▸" — teal

#### TEMPLATE GRID (4 columns, gap 16px, margin-top 28px)
Each card: white bg, border 1px solid #E2E8F0, border-radius 10px, padding 20px, hover: shadow + border-color #00B4D8

Row 1:
1. Tags: "FECHAMENTO" + "COZINHA" (pill badges, bg #F1F5F9, text #64748B, 11px, border-radius 4px)
   Title: "Fechamento Cozinha" — 15px bold
   Desc: "Checklist para garantir o correto fechamento da cozinha" — 13px, #64748B
   Link: "Usar esse template ▸" — teal

2. Tags: "COZINHA" + "ABERTURA"
   Title: "Abertura Cozinha"
   Desc: "Checklist para garantir a correta abertura da cozinha"

3. Tags: "ABERTURA" + "SALÃO"
   Title: "Abertura Salão"
   Desc: "Checklist para garantir a correta abertura do salão"

4. Tags: "FECHAMENTO" + "SALÃO"
   Title: "Fechamento Salão"
   Desc: "Checklist para garantir o correto fechamento do salão"

Row 2:
5. Tags: "ABERTURA" + "CAIXA"
   Title: "Abertura Caixa"
6. Tags: "CAIXA" + "FECHAMENTO"
   Title: "Fechamento Caixa"
7. Tags: "FECHAMENTO" + "BAR"
   Title: "Fechamento Bar"
8. Tags: "ABERTURA" + "BAR"
   Title: "Abertura Bar"

Row 3:
9. Tags: "GERÊNCIA" + "FECHAMENTO"
   Title: "Fechamento Gerência"
   Desc: "Checklist para garantir o correto fechamento e procedimentos da gerência"
10. Tags: "HIGIENE" + "DIÁRIO"
    Title: "Higiene Diária"
11. Tags: "SEGURANÇA" + "ALIMENTAR"
    Title: "Segurança Alimentar"

## STYLE RULES
- Template cards: clean, consistent, hover lifts with shadow
- Tag pills: #F1F5F9 bg, #64748B text, 11px, uppercase, letter-spacing 0.5px
- Hero text: centered, generous whitespace above
- Grid responsive feel: 4 equal columns
- Link color always teal #00B4D8

## OUTPUT
Write the full HTML + inline CSS to the Paper artboard using write_html.
