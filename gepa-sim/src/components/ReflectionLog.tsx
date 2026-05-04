import type { ReflectGroup } from '../types'

function CritiqueBlock({ text }: { text: string }) {
  if (!text) return null
  return (
    <div style={{
      margin: '8px 0',
      padding: '10px 12px',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid var(--clr-border)',
      borderRadius: 6,
      fontSize: 12,
      lineHeight: 1.7,
      color: 'var(--clr-muted)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      maxHeight: 180,
      overflowY: 'auto',
    }}>
      {text}
    </div>
  )
}

function GroupCard({ group }: { group: ReflectGroup }) {
  const { parent, critique, children } = group
  const m = parent.metrics

  return (
    <div style={{ borderBottom: '1px solid var(--clr-border)', padding: '14px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', color: 'var(--clr-seed)' }}>
          {parent.id}
        </span>
        {m && (
          <span style={{ fontSize: 10, color: 'var(--clr-muted)' }}>
            acc@fb {(m.feedback_accuracy * 100).toFixed(0)}% · fmt@fb {(m.feedback_format_rate * 100).toFixed(0)}% · acc@val {(m.accuracy * 100).toFixed(0)}% · fmt@val {(m.val_format_rate * 100).toFixed(0)}% · tok {m.avg_tokens.toFixed(0)}
          </span>
        )}
      </div>

      {/* LLM critique */}
      {critique ? (
        <>
          <div style={{ fontSize: 10, color: 'var(--clr-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            LLM critique
          </div>
          <CritiqueBlock text={critique} />
        </>
      ) : null}

      {/* Proposed children */}
      {children.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, color: 'var(--clr-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Proposed prompts ({children.length})
          </div>
          {children.map((child, i) => (
            <div key={child.id} style={{ marginBottom: i < children.length - 1 ? 8 : 0 }}>
              <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--clr-front)', marginBottom: 3 }}>
                → {child.id}
              </div>
              <pre style={{
                margin: 0,
                padding: '8px 10px',
                background: 'rgba(34,197,94,0.04)',
                border: '1px solid rgba(34,197,94,0.15)',
                borderRadius: 5,
                fontSize: 11,
                lineHeight: 1.6,
                fontFamily: 'monospace',
                color: '#b0b0b0',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 140,
                overflowY: 'auto',
              }}>
                {child.prompt.trim()}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PulsingReflect({ candidateId, streamText }: { candidateId: string; streamText: string }) {
  return (
    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--clr-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--clr-muted)' }}>{candidateId}</span>
        <span style={{ fontSize: 10, color: 'var(--clr-muted)', animation: 'pulse 1.2s ease-in-out infinite' }}>
          streaming reflection…
        </span>
      </div>
      {streamText ? (
        <pre style={{
          margin: 0, padding: '10px 12px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid var(--clr-border)',
          borderRadius: 6, fontSize: 11, lineHeight: 1.65,
          fontFamily: 'monospace', color: 'var(--clr-muted)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 200, overflowY: 'auto',
        }}>
          {streamText}<span style={{ animation: 'blink 1s steps(1) infinite' }}>▌</span>
        </pre>
      ) : (
        <div style={{
          height: 3, borderRadius: 2,
          background: 'linear-gradient(90deg, var(--clr-border) 25%, var(--clr-muted) 50%, var(--clr-border) 75%)',
          backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite',
        }} />
      )}
    </div>
  )
}

export default function ReflectionLog({ groups, running, currentCandidateId, streamingText, title = 'Reflection' }: {
  groups: ReflectGroup[]
  running: boolean
  currentCandidateId: string | null
  streamingText: string
  title?: string
}) {
  const isEmpty = groups.length === 0 && !currentCandidateId

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '10px 16px', borderBottom: '1px solid var(--clr-border)',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{title}</span>
        {groups.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--clr-muted)' }}>
            {groups.reduce((s, g) => s + g.children.length, 0)} variants proposed
          </span>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {isEmpty && (
          <div style={{ padding: 24, color: 'var(--clr-muted)', fontSize: 12 }}>
            Reflection output appears here during the Reflect step.
          </div>
        )}
        {groups.map(g => <GroupCard key={g.parent.id} group={g} />)}
        {running && currentCandidateId && (
          <PulsingReflect candidateId={currentCandidateId} streamText={streamingText} />
        )}
      </div>
    </div>
  )
}
