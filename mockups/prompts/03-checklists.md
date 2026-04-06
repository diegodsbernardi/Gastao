# GASTÃO — Checklists

Use the Paper MCP to create a mockup of the GASTÃO Checklists screen in a new artboard in https://app.paper.design/file/01KNHN04GEB9YHSX4JNKRGKDRB

## SETUP
- Create a new artboard named "03 — Checklists"
- Dimensions: 1440 × 900px
- Same palette and sidebar as Dashboard artboard
- Typography: Inter
- Style: clean SaaS, operational control panel feel

## LAYOUT

### LEFT SIDEBAR (240px) — same as Dashboard, with "Checklists" nav item active (teal highlight)

### MAIN CONTENT (flex: 1, padding 32px, background #F0F7FF)

#### TOP BAR
- Left: "Checklists" — 28px, bold, #1A1A2E
- Below: "Gerencie e execute os checklists operacionais" — 14px, #64748B
- Right: "+ Novo Checklist" button — teal bg, white text, 14px bold, padding 10px 20px, border-radius 8px

#### TAB BAR (margin-top 24px)
- 3 tabs, underline style:
  - "Agendamentos" — **ACTIVE**: teal text, 2px bottom border teal
  - "Executar" — inactive: #64748B
  - "Templates" — inactive: #64748B
- Thin bottom border #E2E8F0 full width

#### TAB CONTENT: "Agendamentos Ativos" (active tab)

**Header Section**
- Left: "Agendamentos Ativos" — 20px bold, #1A1A2E
- Below: "4 processos configurados" — 14px, #64748B
- Right: 3 colored dots (8px): green #22C55E, yellow #F59E0B, orange #F97316 — representing status summary

**Checklist Schedules List (vertical stack, gap 12px, margin-top 20px)**
Each item: white card, border-radius 12px, padding 20px 24px, shadow 0 2px 8px rgba(0,0,0,0.05), flex row align-center

1. **Abertura Cozinha**
   - Left: clock icon in teal circle (40px, bg #E0F7FA, icon #00B4D8)
   - Title: "Abertura Cozinha" — 16px bold, #1A1A2E
   - Subtitle: "Equipe Manhã · 06:00" — 13px, #64748B
   - Right: badge pill "Ativo" — bg #DCFCE7, text #16A34A, 12px, padding 4px 14px, border-radius 20px

2. **Fechamento Caixa**
   - Left: clock icon in blue circle (40px, bg #E0F2FE, icon #0284C7)
   - Title: "Fechamento Caixa" — 16px bold
   - Subtitle: "Operador Caixa · 23:00"
   - Right: badge "Agendado" — bg #E0F2FE, text #0284C7

3. **Abertura Salão**
   - Left: clock icon in teal circle
   - Title: "Abertura Salão"
   - Subtitle: "Equipe Salão · 10:30"
   - Right: badge "Ativo" — green

4. **Fechamento Gerência**
   - Left: clock icon in blue circle
   - Title: "Fechamento Gerência"
   - Subtitle: "Gerente · 23:30"
   - Right: badge "Agendado" — blue

5. **Checklist Higiene**
   - Left: clock icon in teal circle
   - Title: "Checklist Higiene Diária"
   - Subtitle: "Todos · 14:00"
   - Right: badge "Ativo" — green

## STYLE RULES
- Schedule cards: clean white cards, consistent shadow
- Badge pills: soft colored background with matching text, never outline
- Clock icons: circle bg with matching icon color
- Space between cards: 12px
- Tab active: teal color + underline 2px
- Sidebar same style and structure as Dashboard, "Checklists" highlighted

## OUTPUT
Write the full HTML + inline CSS to the Paper artboard using write_html.
