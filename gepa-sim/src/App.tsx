import { useRef, useState, useCallback } from 'react'
import './styles.css'
import PhaseBar from './components/PhaseBar'
import EvolutionTree from './components/EvolutionTree'
import PromptDiff from './components/PromptDiff'
import EvalLog from './components/EvalLog'
import ReflectionLog from './components/ReflectionLog'
import { useSession } from './hooks/useSession'

const TASK_COUNT      = 5    // keep in sync with TASKS in gepa_math_demo.py
const MIN_PANEL_W     = 320
const MAX_PANEL_W     = 900
const DEFAULT_PANEL_W = 480

function BudgetBar({ used, total }: { used: number; total: number }) {
  if (total === 0 || used === 0) return null
  const pct = Math.min(used / total, 1)
  const hot  = pct > 0.8
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, color: 'var(--clr-muted)', whiteSpace: 'nowrap' }}>
        val {used}/{total}
      </span>
      <div style={{ width: 72, height: 4, borderRadius: 2, background: 'var(--clr-border)', overflow: 'hidden' }}>
        <div style={{
          width: `${pct * 100}%`, height: '100%', borderRadius: 2,
          background: hot ? '#f87171' : '#38bdf8',
          transition: 'width 0.4s',
        }} />
      </div>
    </div>
  )
}

export default function App() {
  const { state, running, evalEntries, currentTask, streamingTaskText, streamingReflectText, reflectGroups, start, step } = useSession()

  // ── resizable panel ───────────────────────────────────────────────────────
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_W)
  const dragRef = useRef(false)

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = true
    const startX = e.clientX
    const startW = panelWidth

    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const delta = startX - e.clientX
      setPanelWidth(w => Math.max(MIN_PANEL_W, Math.min(MAX_PANEL_W, startW + delta)))
    }
    const onUp = () => {
      dragRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    document.body.style.cursor    = 'ew-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [panelWidth])

  // ── derived state ─────────────────────────────────────────────────────────
  const isIdle              = state.phase === 'idle'
  const isDone              = state.phase === 'done'
  const canStep             = !isIdle && !running && !isDone
  const frontIds            = new Set(state.front_ids)
  const candidateCount      = Object.keys(state.candidates).length

  const isEvalPhase         = state.phase === 'evaluating_population' || state.phase === 'evaluating_children'
  const isEvalChildrenPhase = state.phase === 'evaluating_children'
  const isReflectPhase      = state.phase === 'reflecting'

  // Right-panel routing
  let rightPanel: 'eval' | 'reflect' | 'eval+reflect' | 'diff' | 'idle'
  if (running && isReflectPhase)                            rightPanel = 'reflect'
  else if (isEvalChildrenPhase && reflectGroups.length > 0) rightPanel = 'eval+reflect'
  else if (running && isEvalPhase)                          rightPanel = 'eval'
  else if (reflectGroups.length > 0)                        rightPanel = 'diff'
  else if (evalEntries.length > 0)                          rightPanel = 'eval'
  else                                                       rightPanel = 'idle'

  const currentReflectId = running && isReflectPhase
    ? (state.population.find(id => !reflectGroups.find(g => g.parent.id === id)) ?? null)
    : null

  const stopLabel = state.stop_reason
    ? { saturated: '✓ Saturated', converged: '✓ Converged', budget: '⚠ Budget used', max_generations: '⏹ Max gens' }[state.stop_reason] ?? state.stop_reason
    : null

  const dragHandle = (
    <div
      onMouseDown={onDragStart}
      style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, cursor: 'ew-resize', zIndex: 10, background: 'transparent' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
      onMouseLeave={e => { if (!dragRef.current) e.currentTarget.style.background = 'transparent' }}
    />
  )

  return (
    <div
      className="app"
      style={{ gridTemplateColumns: `1fr ${panelWidth}px` }}
    >
      <header className="area-phase">
        <PhaseBar phase={state.phase} generation={state.generation} />
      </header>

      <main className="area-tree">
        <EvolutionTree candidates={state.candidates} frontIds={frontIds} running={running} />
      </main>

      <aside className="area-diff" style={{ position: 'relative' }}>
        {dragHandle}

        {rightPanel === 'eval' && (
          <EvalLog entries={evalEntries} currentTask={currentTask} taskCount={TASK_COUNT} streamingText={streamingTaskText} />
        )}

        {rightPanel === 'reflect' && (
          <ReflectionLog groups={reflectGroups} running={running} currentCandidateId={currentReflectId} streamingText={streamingReflectText} />
        )}

        {rightPanel === 'eval+reflect' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ flex: '0 0 58%', borderBottom: '2px solid var(--clr-border)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <EvalLog entries={evalEntries} currentTask={currentTask} taskCount={TASK_COUNT} streamingText={streamingTaskText} />
            </div>
            <div style={{ flex: '1 1 42%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <ReflectionLog
                groups={reflectGroups}
                running={false}
                currentCandidateId={null}
                streamingText=""
                title="Reasoning Trace"
              />
            </div>
          </div>
        )}

        {rightPanel === 'diff' && (
          <PromptDiff groups={reflectGroups} />
        )}

        {rightPanel === 'idle' && (
          <div style={{ padding: 24, color: 'var(--clr-muted)', fontSize: 12 }}>
            {isIdle
              ? 'Start the session and step through phases.'
              : `Click Step to run: ${state.phase.replace(/_/g, ' ')}.`}
          </div>
        )}
      </aside>

      <footer className="area-control">
        <button className="step-btn secondary" onClick={start} disabled={running}>
          {isIdle ? 'Start' : 'Restart'}
        </button>
        <button className="step-btn" onClick={step} disabled={!canStep}>
          {running   ? 'Running…'
           : isDone  ? (stopLabel ?? 'Done')
           : `Step: ${state.phase.replace(/_/g, ' ')}`}
        </button>
        <span className="status-text">
          {running
            ? 'working…'
            : isDone && stopLabel
            ? stopLabel
            : candidateCount > 0
            ? `${candidateCount} candidates`
            : 'click Start'}
        </span>
        <BudgetBar used={state.budget_used} total={state.budget} />
      </footer>
    </div>
  )
}
