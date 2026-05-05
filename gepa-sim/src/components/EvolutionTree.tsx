import { useState, useRef } from 'react'
import type { Candidate } from '../types'

const ROW_H    = 150
const NODE_R   = 28
const CELL_W   = 220
const PAD_TOP  = 60
const PAD_SIDE = 50

interface Pos { x: number; y: number }
interface TooltipState { candidate: Candidate; x: number; y: number; pinned: boolean }

function countLeaves(nodeId: string, candidates: Record<string, Candidate>): number {
  const children = Object.values(candidates).filter(c => c.parent_id === nodeId)
  if (children.length === 0) return 1
  return children.reduce((sum, child) => sum + countLeaves(child.id, candidates), 0)
}

function buildLayout(candidates: Record<string, Candidate>): Record<string, Pos> {
  const roots = Object.values(candidates).filter(c => c.parent_id === null)
  const positions: Record<string, Pos> = {}

  function layout(node: Candidate, depth: number, xLo: number, xHi: number) {
    positions[node.id] = { x: (xLo + xHi) / 2 + PAD_SIDE, y: depth * ROW_H + NODE_R + PAD_TOP }
    const children = Object.values(candidates).filter(c => c.parent_id === node.id)
    if (!children.length) return
    const totalLeaves = children.reduce((s, c) => s + countLeaves(c.id, candidates), 0)
    let cursor = xLo
    children.forEach(child => {
      const slice = (countLeaves(child.id, candidates) / totalLeaves) * (xHi - xLo)
      layout(child, depth + 1, cursor, cursor + slice)
      cursor += slice
    })
  }

  let xOffset = 0
  roots.forEach(root => {
    const leaves = Math.max(countLeaves(root.id, candidates), 1)
    layout(root, 0, xOffset, xOffset + leaves * CELL_W)
    xOffset += leaves * CELL_W
  })
  return positions
}

function nodeColor(c: Candidate, frontIds: Set<string>): string {
  if (!c.parent_id) return 'var(--clr-seed)'
  if (frontIds.has(c.id)) return 'var(--clr-front)'
  return 'var(--clr-dominated)'
}

function metricsLabel(c: Candidate, running: boolean): string {
  if (!c.metrics) return running ? 'evaluating…' : 'pending'
  const fb  = (c.metrics.feedback_accuracy * 100).toFixed(0)
  const val = (c.metrics.accuracy * 100).toFixed(0)
  return `acc@train ${fb}%  acc@val ${val}%`
}

function shortLabel(id: string): string {
  if (id === 'seed') return 'seed'
  const parts = id.split('_')
  const gen = parts.find(p => /^g\d+$/.test(p))
  const relevant = parts.filter(p => /^child\d+$/.test(p) || p === 'fallback')
  if (!relevant.length) return id.slice(0, 5)
  const label = relevant.map(p => p.replace(/^child(\d+)$/, 'c$1').replace('fallback', 'fb')).join('.')
  return gen ? `${gen}.${label}` : label
}

function MiniBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.round(value * 100)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
      <span style={{ fontSize: 10, width: 52, color: '#666', fontFamily: 'monospace', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 4, borderRadius: 2, background: '#252525', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: color, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 10, width: 32, textAlign: 'right', color: '#777', fontFamily: 'monospace', flexShrink: 0 }}>{pct}%</span>
    </div>
  )
}

function Tooltip({ ts, color }: { ts: TooltipState; color: string }) {
  const TOOLTIP_W = 320
  const flipX = ts.x + TOOLTIP_W + 20 > window.innerWidth
  const left  = flipX ? ts.x - TOOLTIP_W - 16 : ts.x + 16
  const top   = Math.min(ts.y - 8, window.innerHeight - 360)
  const c     = ts.candidate

  return (
    <div style={{
      position: 'fixed', left, top, width: TOOLTIP_W,
      background: '#1c1c1c', border: '1px solid #333',
      borderRadius: 8, padding: '12px 14px',
      pointerEvents: ts.pinned ? 'auto' : 'none', zIndex: 1000,
      boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', color }}>{c.id}</span>
        {ts.pinned && <span style={{ fontSize: 9, color: '#555', marginLeft: 2 }}>📌 pinned</span>}
      </div>

      {/* Metric bars */}
      {c.metrics ? (
        <div style={{ marginBottom: 10 }}>
          <MiniBar label="acc@train"  value={c.metrics.feedback_accuracy}    color="#a78bfa" />
          <MiniBar label="fmt@train"  value={c.metrics.feedback_format_rate} color="#c4b5fd" />
          <MiniBar label="acc@val" value={c.metrics.accuracy}             color="#38bdf8" />
          <MiniBar label="fmt@val" value={c.metrics.val_format_rate}      color="#7dd3fc" />
        </div>
      ) : (
        <div style={{ marginBottom: 10, fontSize: 10, color: '#555' }}>evaluating…</div>
      )}

      <div style={{ height: 1, background: '#2a2a2a', marginBottom: 8 }} />

      {/* Prompt */}
      <pre style={{
        margin: 0, fontSize: 11, lineHeight: 1.65,
        fontFamily: 'monospace', color: '#c8c8c8',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        maxHeight: 200, overflowY: 'auto',
      }}>
        {c.prompt.trim()}
      </pre>
    </div>
  )
}

export default function EvolutionTree({ candidates, frontIds, running }: {
  candidates: Record<string, Candidate>
  frontIds: Set<string>
  running: boolean
}) {
  const [tooltip, setTooltip]   = useState<TooltipState | null>(null)
  const hoveredId = useRef<string | null>(null)
  const positions = buildLayout(candidates)
  const allPos    = Object.values(positions)

  if (!allPos.length) {
    return <div style={{ padding: 40, color: 'var(--clr-muted)', fontSize: 12 }}>Click Start then Step to grow the tree.</div>
  }

  const maxX = Math.max(...allPos.map(p => p.x)) + CELL_W / 2 + PAD_SIDE
  const maxY = Math.max(...allPos.map(p => p.y)) + ROW_H

  function handleEnter(c: Candidate, e: React.MouseEvent) {
    hoveredId.current = c.id
    setTooltip(prev => prev?.pinned ? prev : { candidate: c, x: e.clientX, y: e.clientY, pinned: false })
  }

  function handleMove(c: Candidate, e: React.MouseEvent) {
    hoveredId.current = c.id
    setTooltip(prev => {
      if (prev?.pinned) return prev
      return { candidate: c, x: e.clientX, y: e.clientY, pinned: false }
    })
  }

  function handleLeave() {
    hoveredId.current = null
    setTooltip(prev => prev?.pinned ? prev : null)
  }

  function handleClick(c: Candidate, e: React.MouseEvent) {
    e.stopPropagation()
    setTooltip(prev => {
      if (prev?.pinned && prev.candidate.id === c.id) return null
      return { candidate: c, x: e.clientX, y: e.clientY, pinned: true }
    })
  }

  return (
    <div
      style={{ position: 'relative', width: '100%', height: '100%' }}
      onClick={() => setTooltip(prev => prev?.pinned ? null : prev)}
    >
      <svg
        viewBox={`0 0 ${maxX} ${maxY}`}
        width="100%" height="100%"
        style={{ display: 'block', minHeight: 200 }}
        onMouseLeave={handleLeave}
      >
        {Object.values(candidates).map(c => {
          if (!c.parent_id) return null
          const from = positions[c.parent_id], to = positions[c.id]
          if (!from || !to) return null
          const midY = (from.y + to.y) / 2
          return (
            <path key={`e-${c.id}`}
              d={`M${from.x},${from.y} C${from.x},${midY} ${to.x},${midY} ${to.x},${to.y}`}
              fill="none" stroke="var(--clr-border)" strokeWidth={1.5} />
          )
        })}

        {Object.values(candidates).map(c => {
          const pos   = positions[c.id]
          if (!pos) return null
          const color  = nodeColor(c, frontIds)
          const isEval = !c.metrics
          const isPinned = tooltip?.pinned && tooltip.candidate.id === c.id

          return (
            <g key={c.id} style={{ cursor: 'pointer' }}
              onMouseEnter={e => handleEnter(c, e)}
              onMouseMove={e  => handleMove(c, e)}
              onMouseLeave={handleLeave}
              onClick={e => handleClick(c, e)}
            >
              {isEval && (
                <circle cx={pos.x} cy={pos.y} r={NODE_R + 6} fill="none" stroke={color} strokeWidth={1.5} opacity={0.3}>
                  <animate attributeName="r"       values={`${NODE_R+4};${NODE_R+10};${NODE_R+4}`} dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.3;0.05;0.3"                           dur="2s" repeatCount="indefinite" />
                </circle>
              )}
              {isPinned && (
                <circle cx={pos.x} cy={pos.y} r={NODE_R + 5} fill="none" stroke="white" strokeWidth={1.5} opacity={0.4}
                  strokeDasharray="4 3" />
              )}
              {/* Knockout circle — solid bg fill so edges don't bleed through */}
              <circle cx={pos.x} cy={pos.y} r={NODE_R} fill="var(--clr-bg)" />
              <circle cx={pos.x} cy={pos.y} r={NODE_R} fill={color} opacity={isEval ? 0.45 : 1} />

              {/* Pareto front glow dot */}
              {frontIds.has(c.id) && (
                <>
                  <circle cx={pos.x + 19} cy={pos.y - 19} r={7}
                    fill="#ef4444" opacity={0.25}>
                    <animate attributeName="r"       values="7;11;7"      dur="2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.25;0;0.25"  dur="2s" repeatCount="indefinite" />
                  </circle>
                  <circle cx={pos.x + 19} cy={pos.y - 19} r={4} fill="#ef4444">
                    <animate attributeName="opacity" values="1;0.7;1" dur="2s" repeatCount="indefinite" />
                  </circle>
                </>
              )}
              <text x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="middle"
                fontSize={9} fontWeight={700} fill="var(--clr-bg)"
                style={{ userSelect: 'none', pointerEvents: 'none' }}>
                {shortLabel(c.id)}
              </text>
              {c.metrics ? (
                <>
                  <rect
                    x={pos.x - 40} y={pos.y + NODE_R + 10}
                    width={80} height={24} rx={3}
                    fill="var(--clr-bg)" opacity={0.85}
                    style={{ pointerEvents: 'none' }}
                  />
                  <text textAnchor="middle" fontSize={8} fontWeight={400} fill="var(--clr-muted)"
                    style={{ userSelect: 'none', pointerEvents: 'none' }}>
                    <tspan x={pos.x} y={pos.y + NODE_R + 20}>
                      acc@train {(c.metrics.feedback_accuracy * 100).toFixed(0)}%
                    </tspan>
                    <tspan x={pos.x} dy={10}>
                      acc@val {(c.metrics.accuracy * 100).toFixed(0)}%
                    </tspan>
                  </text>
                </>
              ) : (
                <text x={pos.x} y={pos.y + NODE_R + 21} textAnchor="middle"
                  fontSize={8} fontWeight={400} fill="var(--clr-muted)"
                  style={{ userSelect: 'none', pointerEvents: 'none' }}>
                  {metricsLabel(c, running)}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {tooltip && <Tooltip ts={tooltip} color={nodeColor(tooltip.candidate, frontIds)} />}
    </div>
  )
}
