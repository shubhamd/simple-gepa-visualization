import type { SessionState } from '../types'

export default function PhaseInfo({ state, running }: { state: SessionState; running: boolean }) {
  const { phase, population, pending_children, front_ids, candidates, generation, budget_used, budget, stop_reason } = state

  let now  = ''
  let next = ''

  const popCount   = population.length
  const childCount = pending_children.length

  if (phase === 'idle') {
    now  = 'No session active.'
    next = 'Click Start to seed the initial prompt, then use Step to advance each phase.'

  } else if (phase === 'evaluating_population') {
    now  = running
      ? `Scoring ${popCount} prompt${popCount !== 1 ? 's' : ''} on all tasks (training + held-out splits).`
      : `Ready to score ${popCount} prompt${popCount !== 1 ? 's' : ''} on all tasks.`
    next = `The reflection LLM will analyze training task failures and propose 2 child variants per prompt — glowing nodes will each be forked.`

  } else if (phase === 'reflecting') {
    now  = running
      ? `LLM analyzing training failures for ${popCount} prompt${popCount !== 1 ? 's' : ''} — held-out task traces are never shown to it.`
      : `Ready to reflect on ${popCount} prompt${popCount !== 1 ? 's' : ''}.`
    const n = popCount * 2
    next = `${n} child prompt${n !== 1 ? 's' : ''} will be created, then scored on all tasks next.`

  } else if (phase === 'evaluating_children') {
    now  = running
      ? `Scoring ${childCount} child${childCount !== 1 ? 'ren' : ''} on all tasks.`
      : `Ready to score ${childCount} child${childCount !== 1 ? 'ren' : ''}.`
    next = `Pareto selection will keep any candidate not dominated on held-out instance scores — a child must improve acc@val or fmt@val to displace a glowing front node.`

  } else if (phase === 'selecting') {
    const total = population.length + pending_children.length
    now  = `Pareto selection across ${total} candidates — comparing held-out instance scores only, feedback accuracy is not considered.`
    next = `Survivors become Gen ${generation + 1} population. Each glowing survivor will fork 2 new child prompts in the Reflect step.`

  } else if (phase === 'done') {
    const reasons: Record<string, string> = {
      saturated:       `All front members hit acc@val 100% — no room to improve on held-out tasks.`,
      converged:       `Pareto front unchanged from last generation — mutations stopped making progress.`,
      budget:          `Val evaluation budget exhausted (${budget_used}/${budget} evals used).`,
      max_generations: `Maximum generation cap reached (Gen ${generation}).`,
    }
    now  = reasons[stop_reason ?? ''] ?? 'Session complete.'
    next = 'Click Restart to begin a new session.'
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16,
      padding: '0 24px', height: '100%',
      fontSize: 11, color: 'var(--clr-muted)',
      borderTop: '1px solid var(--clr-border)',
      overflow: 'hidden',
    }}>
      <span style={{ flexShrink: 0, color: '#9ca3af' }}>
        <span style={{ color: '#6b7280', marginRight: 5 }}>now</span>
        {now}
      </span>

      {next && <span style={{ flexShrink: 0, color: 'var(--clr-border)', fontSize: 14 }}>→</span>}

      {next && (
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#9ca3af' }}>
          <span style={{ color: '#6b7280', marginRight: 5 }}>next</span>
          {next}
        </span>
      )}
    </div>
  )
}
