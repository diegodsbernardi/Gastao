# GASTÃO — Dashboard (Painel)

Use the Paper MCP to create a mockup of the GASTÃO Dashboard in a new artboard in https://app.paper.design/file/01KNHN04GEB9YHSX4JNKRGKDRB

## SETUP
- Create a new artboard named "02 — Dashboard"
- Dimensions: 1440 × 900px
- Palette:
  - Sidebar BG: #1B2A4A
  - Teal: #00B4D8 (active states, CTAs)
  - White: #FFFFFF (cards)
  - Page BG: #F0F7FF
  - Green: #22C55E (success, positive)
  - Orange: #F59E0B (warning)
  - Red: #EF4444 (danger, critical)
  - Text Dark: #1A1A2E
  - Text Muted: #64748B
  - Border: #E2E8F0
- Typography: Inter
- Style: clean SaaS dashboard, data-rich but spacious

## LAYOUT

### LEFT SIDEBAR (240px wide, fixed, background #1B2A4A)
- Top (padding 24px): GASTÃO logo — coral circle (36px) with white "G" + "GASTÃO" text white 18px bold
- Spacing 32px
- Nav items (vertical list, padding 0 16px), each item: 44px tall, 12px border-radius, padding-left 16px
  - Icon (20px, Lucide style) + Label (14px) for each:
  - "Painel" — LayoutDashboard icon — **ACTIVE**: background rgba(0,180,216,0.15), left border 3px solid #00B4D8, text #00B4D8
  - "Checklists" — ClipboardCheck icon — inactive: text #94A3B8
  - "Receitas" — ChefHat icon — inactive
  - "Fichas Técnicas" — FileText icon — inactive
  - "Estoque" — Package icon — inactive
  - "Equipe" — Users icon — inactive
  - "Relatórios" — BarChart3 icon — inactive
  - "Clientes" — Heart icon — inactive
  - "Configurações" — Settings icon — inactive
- Bottom (padding 24px): user avatar circle (40px, #00B4D8 bg, white initials "DM"), "Diego Martins" 14px white, "Gerente" 12px #64748B

### MAIN CONTENT (flex: 1, padding 32px, background #F0F7FF)

#### TOP BAR
- Left: "Bom dia, Diego! 👋" — 24px, bold, #1A1A2E
- Below: "Restaurante Gastão · Domingo, 6 de Abril de 2026" — 14px, #64748B
- Right: notification bell icon (20px) with red dot badge + user avatar (36px circle)

#### KPI CARDS ROW (4 cards, gap 20px, margin-top 28px)
Each card: white bg, border-radius 12px, padding 24px, shadow 0 2px 8px rgba(0,0,0,0.05)

1. **Checklists Concluídos**: circular progress ring (teal, 72px) showing "8/12" inside, label below "Checklists Concluídos", sub-label "67% completos" in #64748B
2. **Alertas de Estoque**: large number "3" in #F59E0B (36px bold), label "Alertas de Estoque", sub-label "itens abaixo do mínimo", orange warning icon
3. **Feedbacks Pendentes**: large number "2" in #00B4D8 (36px bold), label "Feedbacks Pendentes", sub-label "colaboradores este mês"
4. **Custo Operacional Hoje**: "R$ 1.240" in #1A1A2E (36px bold), label "Custo Operacional", sub-label "↓ 8% vs. ontem" in #22C55E

#### BOTTOM SECTION (2 columns, gap 24px, margin-top 24px)

**LEFT COLUMN (60%)**
Card: "Checklists do Dia" — white bg, border-radius 12px, padding 24px
- Header: "Checklists do Dia" 18px bold + "Ver todos →" link in teal on right
- List (5 items), each row with:
  - Status dot: green (#22C55E) for done, orange (#F59E0B) for pending, red (#EF4444) for late
  - Checklist name (14px bold): e.g., "Abertura Cozinha"
  - Assignee name (13px, #64748B): e.g., "João Silva"
  - Time (13px, #94A3B8): e.g., "06:00"
  - Progress bar (100px wide, 6px tall, teal fill)
  - Status badge pill: "Concluído" (green bg/text), "Pendente" (orange), "Atrasado" (red)
- Sample data:
  - Abertura Cozinha | João Silva | 06:00 | 100% | Concluído
  - Abertura Salão | Maria Santos | 10:30 | 100% | Concluído
  - Checklist Higiene | Carlos Lima | 11:00 | 60% | Pendente
  - Abertura Caixa | Ana Costa | 09:00 | 100% | Concluído
  - Prep Almoço | João Silva | 08:00 | 30% | Atrasado

**RIGHT COLUMN (40%)**
Card: "Alertas" — white bg, border-radius 12px, padding 24px
- Header: "Alertas Recentes" 18px bold
- List (4 alert items), each:
  - Icon circle (32px): orange for stock, red for missed checklist, teal for info
  - Title (14px bold): e.g., "Estoque baixo: Bacon"
  - Description (13px, #64748B): e.g., "Apenas 2kg restantes — mínimo 5kg"
  - Time (12px, #94A3B8): e.g., "há 2h"
- Sample alerts:
  - 🟠 Estoque baixo: Bacon | 2kg restantes (mín. 5kg) | há 2h
  - 🔴 Checklist atrasado: Prep Almoço | João Silva não completou | há 1h
  - 🟠 Estoque baixo: Queijo Prato | 3kg restantes (mín. 8kg) | há 3h
  - 🔵 Feedback pendente | Ana Costa — vence em 3 dias | há 5h

## STYLE RULES
- Cards: white bg, 12px radius, shadow 0 2px 8px rgba(0,0,0,0.05)
- Status badges: pill shape, padding 4px 12px, 12px font, border-radius 20px
- Progress bars: 6px tall, border-radius 3px, #E2E8F0 track, teal fill
- Sidebar nav hover: background rgba(255,255,255,0.05)
- Active nav: left teal border + teal text + subtle teal bg
- Consistent 8px spacing grid

## OUTPUT
Write the full HTML + inline CSS to the Paper artboard using write_html.
