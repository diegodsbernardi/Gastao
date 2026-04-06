# GASTÃO — Login Screen

Use the Paper MCP to create a mockup of the GASTÃO Login screen in a new artboard in https://app.paper.design/file/01KNHN04GEB9YHSX4JNKRGKDRB

## SETUP
- Create a new artboard named "01 — Login"
- Dimensions: 1440 × 900px (desktop web app)
- Palette:
  - Dark Navy: #1B2A4A (sidebar, dark sections)
  - Teal/Cyan: #00B4D8 (CTAs, active states, links)
  - White: #FFFFFF (cards, backgrounds)
  - Light BG: #F0F7FF (page backgrounds)
  - Light Gray: #E2E8F0 (borders, dividers)
  - Text Dark: #1A1A2E (headings)
  - Text Muted: #64748B (body, placeholders)
  - Coral Accent: #E85D4A (logo mark only)
- Typography: Inter, system sans-serif fallback
- Style: clean, modern SaaS — soft shadows, rounded cards, professional. NOT lo-fi wireframe — use real colors, proper styling.

## LAYOUT
Full-screen split layout:

### LEFT HALF (50% width, background #1B2A4A)
- Vertically centered content, padding 80px
- GASTÃO logo: coral/red circular mark (64px circle, #E85D4A) with white stylized "G" inside
- Below logo: "GASTÃO" text in white, 36px, bold, Inter
- Below name: "Inteligência Operacional" — 16px, #94A3B8, light weight
- Bottom left: small text "© 2026 GASTÃO. Todos os direitos reservados." — 12px, #64748B

### RIGHT HALF (50% width, background #F0F7FF)
- Vertically and horizontally centered card
- Card: white #FFFFFF, 480px wide, padding 48px, border-radius 16px, box-shadow 0 4px 24px rgba(0,0,0,0.08)
- Inside card:
  - Heading: "Bem-vindo de volta" — 28px, bold, #1A1A2E
  - Subtext: "Acesse sua conta para continuar" — 14px, #64748B, margin-bottom 32px
  - Label: "E-mail" — 13px, #64748B, bold
  - Input field: full width, height 48px, border 1.5px solid #E2E8F0, border-radius 10px, placeholder "seu@email.com", padding-left 16px
  - Spacing 20px
  - Label: "Senha" — 13px, #64748B, bold
  - Input field: same style, placeholder "••••••••", with eye icon (16px) on right side
  - Spacing 12px
  - Right-aligned link: "Esqueci minha senha" — 13px, #00B4D8, no underline
  - Spacing 28px
  - Button: "Entrar" — full width, height 50px, background #00B4D8, color white, 16px bold, border-radius 10px, hover state slightly darker
  - Spacing 24px
  - Divider: horizontal line with "ou" text centered on it — #E2E8F0 line, "ou" in #94A3B8
  - Spacing 24px
  - Button: "Entrar com Google" — full width, height 48px, background white, border 1.5px solid #E2E8F0, border-radius 10px, Google "G" icon on left, text #1A1A2E 14px
  - Spacing 32px
  - Bottom text: "Não tem conta? " + "Fale com vendas" (teal link) — 14px, centered

## STYLE RULES
- Card shadow: 0 4px 24px rgba(0,0,0,0.08)
- All inputs: transition on focus, focus state border-color #00B4D8
- Button hover: background #0096B7
- Border-radius: 10px for inputs, 10px for buttons, 16px for card
- No lo-fi/wireframe style — this should look like a production SaaS login

## OUTPUT
Write the full HTML + inline CSS to the Paper artboard using write_html.
