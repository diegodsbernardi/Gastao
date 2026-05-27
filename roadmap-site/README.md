# Gastão · Roadmap Site

Site visual do roadmap do Gastão. Deploy separado do app principal.

## Stack
- Vite + React + TypeScript
- TailwindCSS (paleta consistente com Gastão)
- Sem backend — dados em `src/data.ts`, editado direto

## Como atualizar
A cada feature concluída/iniciada, editar `src/data.ts`:
- Trocar `done: false` por `done: true` + adicionar `date`
- Mudar `status` do marco quando inicia/fecha
- Atualizar `lastUpdated`

Commit + push → Vercel re-deploya sozinho.

## Local dev
```bash
npm install
npm run dev    # http://localhost:5173
npm run build  # gera dist/
```

## Deploy (primeira vez)
```bash
npm install -g vercel  # se não tiver
vercel              # cria projeto novo
vercel --prod       # deploy production
```

Depois cada push pra `master` re-deploya via integração GitHub.
