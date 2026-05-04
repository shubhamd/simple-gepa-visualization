import type { Phase } from '../types'

const PHASES: { key: Phase; label: string }[] = [
  { key: 'evaluating_population', label: 'Evaluate' },
  { key: 'reflecting',            label: 'Reflect' },
  { key: 'evaluating_children',   label: 'Score Children' },
  { key: 'selecting',             label: 'Select' },
]

const ORDER: Phase[] = PHASES.map(p => p.key)

function stepIndex(phase: Phase): number {
  return ORDER.indexOf(phase)
}

export default function PhaseBar({ phase, generation }: { phase: Phase; generation: number }) {
  if (phase === 'done') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
        <span style={{ color: 'var(--clr-muted)', fontSize: 12, marginRight: 12, whiteSpace: 'nowrap' }}>
          Gen {generation}
        </span>
        {PHASES.map((p, i) => (
          <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 400,
              background: 'var(--clr-border)', color: 'var(--clr-muted)',
              border: '1px solid var(--clr-border)',
            }}>
              <span style={{ marginRight: 4 }}>✓</span>{p.label}
            </div>
            {i < PHASES.length - 1 && (
              <div style={{ width: 24, height: 1, background: 'var(--clr-border)' }} />
            )}
          </div>
        ))}
        <div style={{ marginLeft: 12, padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: 'rgba(74,222,128,0.15)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.3)' }}>
          ✓ Converged
        </div>
      </div>
    )
  }

  const active = stepIndex(phase)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
      <span style={{ color: 'var(--clr-muted)', fontSize: 12, marginRight: 12, whiteSpace: 'nowrap' }}>
        Gen {generation}
      </span>
      {PHASES.map((p, i) => {
        const done    = i < active
        const current = i === active
        return (
          <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              padding: '4px 12px',
              borderRadius: 20,
              fontSize: 12,
              fontWeight: current ? 600 : 400,
              background: current ? 'var(--clr-text)' : done ? 'var(--clr-border)' : 'transparent',
              color: current ? 'var(--clr-bg)' : done ? 'var(--clr-muted)' : 'var(--clr-muted)',
              border: current ? 'none' : '1px solid var(--clr-border)',
              transition: 'all 0.2s',
            }}>
              {done && <span style={{ marginRight: 4 }}>✓</span>}
              {p.label}
            </div>
            {i < PHASES.length - 1 && (
              <div style={{ width: 24, height: 1, background: 'var(--clr-border)' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}
