# Gastão — instruções do projeto

**Gastão** é um SaaS multi-tenant de gestão operacional e CMV para restaurantes.
O app real vive em **`gastao-app/`** (Vite + React 19 + TS + Tailwind + Supabase).
Deploy: **`gastao-app.vercel.app`** (a partir de `gastao-app/`, tem `vercel.json` próprio).

> ⚠️ Existe um projeto Vercel **`gastao`** separado, dono do domínio `gastao.vercel.app`
> e parado desde ~maio/2026. Ele NÃO recebe nossos deploys e não tem as features novas.
> Nunca validar deploy por `gastao.vercel.app` — o domínio responde 200 servindo o app velho.

> Histórico: este repo nasceu de um fork do framework "Opensquad". Todo esse
> scaffold foi removido — se aparecer referência a Opensquad em algum lugar, é
> resíduo e pode ir embora.

## Estrutura
- `gastao-app/` — o app (front + edge functions + migrations Supabase). É o que importa.
- `roadmap-site/` — site de roadmap (deploy separado, `vercel.json` próprio).
- `docs/` — ROADMAP.md + handoffs de sessão. **Versionado** (não ignorar).
- `Bibliografia/` — manual de identidade visual (assets de marca).

## Stack e convenções
- React + TypeScript + Supabase + Tailwind. Multi-tenancy por RLS (`get_my_restaurant_id()`).
- Modelo de custo em 3 camadas: Insumo Base → Preparo → (Preparo)* → Ficha Final.
- Commits em português. Antes de editar: ler o arquivo.

## Banco / migrations
- Migrations em `gastao-app/supabase/migrations/` (numeradas, aplicar em ordem).
- Utilitário `gastao-app/scripts/sb-query.mjs` roda SQL no Supabase (lê
  `~/.gastao-supabase.env`, gitignored). Nunca commitar segredos.
- Projeto Supabase: `GASTAO` (produção com dados reais de clientes beta —
  Brut, TOCS, Criminal, Yalinha, TOCS BURGER). Não apagar dado de cliente.

## Build
- `cd gastao-app && npm run build` (gera template + tsc + vite).

## Deploy de edge functions
- `SUPABASE_ACCESS_TOKEN=$(cat ~/.supabase/access-token) npx supabase functions deploy <nome> --project-ref hvnxvqycvnwquugnygzf` — funciona sem Docker/login interativo. `supabase/config.toml` versiona `verify_jwt=true`.
- Segurança (auditoria 12/07): `match-nfe-items`/`interpret-ficha-tecnica` exigem `getUser()` (barram anon key pura → sem abuso de LLM); `parse-nfe` só exige header (o robô usa anon key nele).

## Ponte Drive → NF-e
- Robô `gastao-app/scripts/nfe-drive-sync.mjs` roda via cron do VPS (08h/17h BRT),
  importa XMLs das pastas `NotasEntrada` no Drive como notas `pendente`.
- Config por restaurante na tabela `nfe_drive_sync`; dedup por `chave_acesso`.
- Detalhes e setup: `docs/specs/2026-07-03-ponte-drive-nfe.md`.
