import { useState, useEffect } from 'react'
import type { ReflectGroup } from '../types'

type DiffKind = 'same' | 'added' | 'removed'
interface DiffLine { text: string; kind: DiffKind }

function diffLines(a: string[], b: string[]): DiffLine[] {
  const n = a.length, m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1])
  const result: DiffLine[] = []
  let i = n, j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i-1] === b[j-1]) {
      result.unshift({ text: a[i-1], kind: 'same' }); i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      result.unshift({ text: b[j-1], kind: 'added' }); j--
    } else {
      result.unshift({ text: a[i-1], kind: 'removed' }); i--
    }
  }
  return result
}

const BG:  Record<DiffKind, string> = { same: 'transparent', added: 'rgba(34,197,94,0.12)',  removed: 'rgba(239,68,68,0.12)' }
const CLR: Record<DiffKind, string> = { same: 'var(--clr-text)', added: '#86efac', removed: '#fca5a5' }

function DiffPane({ lines, title }: { lines: DiffLine[]; title: string }) {
  return (
    <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
      <div style={{
        padding: '8px 14px', fontSize: 10, color: 'var(--clr-muted)',
        borderBottom: '1px solid var(--clr-border)', fontFamily: 'monospace',
        position: 'sticky', top: 0, background: 'var(--clr-surface)',
      }}>
        {title}
      </div>
      <pre style={{
        margin: 0, padding: '10px 14px', fontSize: 11, lineHeight: 1.7,
        fontFamily: 'monospace',
        whiteSpace: 'pre-wrap',   /* wrap long lines */
        wordBreak: 'break-word',
        overflowX: 'hidden',
      }}>
        {lines.map((l, i) => (
          <div key={i} style={{ background: BG[l.kind], color: CLR[l.kind], borderRadius: 2, padding: '0 2px' }}>
            {l.kind === 'added' ? '+ ' : l.kind === 'removed' ? '- ' : '  '}{l.text || ' '}
          </div>
        ))}
      </pre>
    </div>
  )
}

function Reasoning({ critique }: { critique: string }) {
  const [open, setOpen] = useState(true)
  if (!critique) return null
  return (
    <div style={{ borderTop: '1px solid var(--clr-border)', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', textAlign: 'left',
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 6,
          color: 'var(--clr-muted)', fontSize: 11,
        }}
      >
        <span style={{ fontSize: 9, transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
        Reflection reasoning
      </button>
      {open && (
        <div style={{
          padding: '0 14px 12px',
          fontSize: 11, lineHeight: 1.65, color: 'var(--clr-muted)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 160, overflowY: 'auto',
          borderTop: '1px solid rgba(255,255,255,0.04)',
        }}>
          {critique}
        </div>
      )}
    </div>
  )
}

// Flat list of all parent→child pairs, carrying critique from their group
function buildPairs(groups: ReflectGroup[]) {
  return groups.flatMap(g =>
    g.children.map(child => ({ parent: g.parent, child, critique: g.critique }))
  )
}

export default function PromptDiff({ groups }: { groups: ReflectGroup[] }) {
  const [idx, setIdx] = useState(0)
  const pairs = buildPairs(groups)

  useEffect(() => { setIdx(0) }, [groups.length])

  if (!pairs.length) {
    return (
      <div style={{ padding: 24, color: 'var(--clr-muted)', fontSize: 12 }}>
        Prompt diff appears here after the Reflect step.
      </div>
    )
  }

  const current = pairs[Math.min(idx, pairs.length - 1)]
  const { parent, child, critique } = current
  const diff  = diffLines(parent.prompt.split('\n'), child.prompt.split('\n'))
  const total = pairs.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--clr-border)',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Prompt diff</span>
        <span style={{ fontSize: 11, color: 'var(--clr-muted)', fontFamily: 'monospace', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {parent.id} → {child.id}
        </span>
        {total > 1 && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: 'var(--clr-muted)' }}>{idx + 1}/{total}</span>
            <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
              style={{ background: 'none', border: '1px solid var(--clr-border)', borderRadius: 4, padding: '2px 8px', cursor: idx === 0 ? 'default' : 'pointer', fontSize: 12, color: idx === 0 ? 'var(--clr-border)' : 'var(--clr-text)' }}>
              ‹
            </button>
            <button onClick={() => setIdx(i => Math.min(total - 1, i + 1))} disabled={idx === total - 1}
              style={{ background: 'none', border: '1px solid var(--clr-border)', borderRadius: 4, padding: '2px 8px', cursor: idx === total - 1 ? 'default' : 'pointer', fontSize: 12, color: idx === total - 1 ? 'var(--clr-border)' : 'var(--clr-text)' }}>
              ›
            </button>
          </div>
        )}
      </div>

      {/* Dot indicators */}
      {total > 1 && (
        <div style={{ display: 'flex', gap: 4, padding: '6px 14px', borderBottom: '1px solid var(--clr-border)', flexShrink: 0 }}>
          {pairs.map((p, i) => (
            <button key={i} onClick={() => setIdx(i)}
              title={`${p.parent.id} → ${p.child.id}`}
              style={{
                width: 6, height: 6, borderRadius: '50%', border: 'none', padding: 0, cursor: 'pointer',
                background: i === idx ? 'var(--clr-text)' : 'var(--clr-border)',
                transition: 'background 0.15s',
              }} />
          ))}
        </div>
      )}

      {/* Diff panes */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <DiffPane lines={diff.filter(l => l.kind !== 'added')}   title={parent.id} />
        <div style={{ width: 1, background: 'var(--clr-border)', flexShrink: 0 }} />
        <DiffPane lines={diff.filter(l => l.kind !== 'removed')} title={child.id} />
      </div>

      {/* Reflection reasoning below the diff */}
      <Reasoning critique={critique} />
    </div>
  )
}
