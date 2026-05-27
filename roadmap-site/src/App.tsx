import { milestones, lastUpdated, closedDecisions, type Milestone, type Status } from './data';

const statusConfig: Record<Status, { label: string; emoji: string; bg: string; ring: string; bar: string; text: string }> = {
  done:        { label: 'Concluído',    emoji: '✅', bg: 'bg-emerald-50',  ring: 'ring-emerald-200',  bar: 'bg-emerald-500',  text: 'text-emerald-700' },
  in_progress: { label: 'Em progresso', emoji: '🟡', bg: 'bg-primary-50',  ring: 'ring-primary-300',  bar: 'bg-primary-500',  text: 'text-primary-700' },
  next:        { label: 'Próximo',      emoji: '🔵', bg: 'bg-sky-50',      ring: 'ring-sky-200',      bar: 'bg-sky-500',      text: 'text-sky-700' },
  backlog:     { label: 'Backlog',      emoji: '🟣', bg: 'bg-violet-50',   ring: 'ring-violet-200',   bar: 'bg-violet-500',   text: 'text-violet-700' },
  future:      { label: 'Futuro',       emoji: '🔴', bg: 'bg-slate-50',    ring: 'ring-slate-200',    bar: 'bg-slate-400',    text: 'text-slate-600' },
};

function percentDone(m: Milestone): number {
  if (m.items.length === 0) return 0;
  return Math.round((m.items.filter(i => i.done).length / m.items.length) * 100);
}

function MilestoneCard({ m }: { m: Milestone }) {
  const cfg = statusConfig[m.status];
  const pct = percentDone(m);
  const totalDone = m.items.filter(i => i.done).length;
  return (
    <div className={`${cfg.bg} ring-1 ${cfg.ring} rounded-2xl p-6 shadow-sm`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className={`text-xs font-semibold uppercase tracking-wider ${cfg.text} mb-1`}>
            {cfg.emoji} Marco {m.id} · {cfg.label}
          </div>
          <h2 className="text-2xl font-bold text-ink">{m.name}</h2>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">{m.subtitle}</p>
        </div>
        <div className="text-right text-sm">
          <div className="font-mono text-ink font-semibold">{pct}%</div>
          <div className="text-slate-500">{totalDone} de {m.items.length} itens</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4 h-2 bg-white/60 rounded-full overflow-hidden">
        <div className={`h-full ${cfg.bar} transition-all`} style={{ width: `${pct}%` }} />
      </div>

      {/* Items */}
      <ul className="mt-5 space-y-2">
        {m.items.map((it, i) => (
          <li key={i} className="flex items-start gap-3 text-sm">
            <span className={`flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded ${
              it.done ? 'bg-emerald-500 text-white'
                : it.inProgress ? 'bg-primary-200 text-primary-700'
                : 'bg-white border border-slate-300'
            }`}>
              {it.done ? '✓' : it.inProgress ? '·' : ''}
            </span>
            <span className={it.done ? 'text-slate-700 line-through decoration-slate-300' : 'text-ink'}>
              {it.text}
            </span>
            {it.date && <span className="text-xs text-slate-400 font-mono ml-auto whitespace-nowrap pl-2">{it.date}</span>}
          </li>
        ))}
      </ul>

      {/* Footer com métricas */}
      <div className="mt-5 pt-4 border-t border-white/60 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div>
          <div className="text-slate-500 uppercase tracking-wide">Estimado</div>
          <div className="font-mono font-semibold text-ink">{m.estimatedHours}</div>
        </div>
        {m.actualHours && (
          <div>
            <div className="text-slate-500 uppercase tracking-wide">Real</div>
            <div className="font-mono font-semibold text-ink">{m.actualHours}</div>
          </div>
        )}
        {m.calendarWindow && (
          <div className="col-span-2">
            <div className="text-slate-500 uppercase tracking-wide">Janela</div>
            <div className="font-mono font-semibold text-ink">{m.calendarWindow}</div>
          </div>
        )}
      </div>

      {m.notes && (
        <div className="mt-3 text-xs text-slate-600 italic bg-white/50 rounded-lg p-3 border border-white/80">
          💡 {m.notes}
        </div>
      )}
    </div>
  );
}

function StatusLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs">
      {(Object.entries(statusConfig) as [Status, typeof statusConfig.done][]).map(([k, cfg]) => (
        <div key={k} className="flex items-center gap-1.5">
          <span className={`w-2.5 h-2.5 rounded-full ${cfg.bar}`} />
          <span className="text-slate-600">{cfg.emoji} {cfg.label}</span>
        </div>
      ))}
    </div>
  );
}

function OverallProgress() {
  const allItems = milestones.flatMap(m => m.items);
  const totalDone = allItems.filter(i => i.done).length;
  const totalPct = Math.round((totalDone / allItems.length) * 100);
  const marcosFechados = milestones.filter(m => m.status === 'done').length;
  return (
    <div className="bg-gradient-to-br from-primary-500 to-primary-600 text-white rounded-2xl p-6 shadow-lg">
      <div className="text-xs font-semibold uppercase tracking-wider opacity-90 mb-1">Progresso geral</div>
      <div className="flex items-end gap-3">
        <div className="text-5xl font-bold font-mono">{totalPct}%</div>
        <div className="text-sm opacity-90 mb-2">
          {totalDone} de {allItems.length} itens · {marcosFechados}/{milestones.length} marcos fechados
        </div>
      </div>
      <div className="mt-4 h-3 bg-white/20 rounded-full overflow-hidden">
        <div className="h-full bg-white transition-all" style={{ width: `${totalPct}%` }} />
      </div>
    </div>
  );
}

export function App() {
  return (
    <div className="min-h-screen bg-cream">
      <div className="max-w-5xl mx-auto px-4 py-10 md:py-16">
        {/* Header */}
        <header className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary-500 flex items-center justify-center text-white text-xl font-bold">G</div>
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-ink">Gastão · Roadmap</h1>
              <div className="text-sm text-slate-500 font-mono">Atualizado em {lastUpdated}</div>
            </div>
          </div>
          <p className="text-slate-600 max-w-2xl">
            Mapa de execução do produto Gastão — SaaS de gestão de fichas técnicas e CMV pra restaurantes,
            distribuído via BPO contábil (canal B2B2B com a Cinco).
          </p>
        </header>

        {/* Progress geral + legenda */}
        <div className="grid md:grid-cols-3 gap-4 mb-8">
          <div className="md:col-span-2">
            <OverallProgress />
          </div>
          <div className="bg-white rounded-2xl p-5 ring-1 ring-slate-200 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Legenda</div>
            <StatusLegend />
          </div>
        </div>

        {/* Marcos */}
        <div className="space-y-5">
          {milestones.map(m => <MilestoneCard key={m.id} m={m} />)}
        </div>

        {/* Decisões fechadas */}
        <section className="mt-10 bg-white rounded-2xl p-6 ring-1 ring-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-ink mb-1">🔒 Decisões fechadas</h3>
          <p className="text-xs text-slate-500 mb-4">Não rediscutir — tratado como premissa em todas as próximas iterações.</p>
          <ul className="space-y-2">
            {closedDecisions.map((d, i) => (
              <li key={i} className="text-sm text-slate-700 flex items-start gap-2">
                <span className="text-emerald-500 font-bold flex-shrink-0">✓</span>
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Footer */}
        <footer className="mt-10 text-center text-xs text-slate-400">
          Gerado a partir de <span className="font-mono">roadmap-site/src/data.ts</span> ·
          Atualizado pelo Claude no curso da execução
        </footer>
      </div>
    </div>
  );
}
