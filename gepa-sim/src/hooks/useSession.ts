import { useState, useRef, useCallback, useEffect } from 'react'
import type { SessionState, Candidate, Metrics, EvalEntry, ReflectGroup } from '../types'

const EMPTY_STATE: SessionState = {
  phase: 'idle',
  generation: 0,
  candidates: {},
  population: [],
  pending_children: [],
  front_ids: [],
  budget_used: 0,
  budget: 20,
  stop_reason: null,
}

export function useSession() {
  const [state, setState]                   = useState<SessionState>(EMPTY_STATE)
  const [running, setRunning]               = useState(false)
  const [evalEntries, setEvalEntries]       = useState<EvalEntry[]>([])
  const [currentTask, setCurrentTask]       = useState<{ candidate_id: string; task_index: number; question: string; split: 'feedback' | 'pareto' } | null>(null)
  const [streamingTaskText, setStreamingTaskText]       = useState('')
  const [streamingReflectText, setStreamingReflectText] = useState('')
  const [reflectGroups, setReflectGroups]   = useState<ReflectGroup[]>([])
  const esRef = useRef<EventSource | null>(null)

  const pendingChildrenRef = useRef<Record<string, Candidate[]>>({})

  // Close stream cleanly on page unload so the server drops the generator
  useEffect(() => {
    const onUnload = () => {
      esRef.current?.close()
      esRef.current = null
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  const start = useCallback(async () => {
    esRef.current?.close()
    esRef.current = null
    const res = await fetch('/session/start', { method: 'POST' })
    const data: SessionState = await res.json()
    setState(data)
    setEvalEntries([])
    setCurrentTask(null)
    setStreamingTaskText('')
    setStreamingReflectText('')
    setReflectGroups([])
    pendingChildrenRef.current = {}
  }, [])

  const step = useCallback((currentPhase: string) => {
    if (running) return
    setRunning(true)
    setEvalEntries([])
    setCurrentTask(null)
    setStreamingTaskText('')
    setStreamingReflectText('')

    // Preserve reflection groups during evaluating_children so the "Reasoning Trace"
    // panel stays visible alongside the eval output. Clear for all other phases.
    if (currentPhase !== 'evaluating_children') {
      setReflectGroups([])
      pendingChildrenRef.current = {}
    }

    const es = new EventSource('/session/step')
    esRef.current = es

    es.addEventListener('task_start', e => {
      const d: { candidate_id: string; task_index: number; question: string; split: 'feedback' | 'pareto' } = JSON.parse(e.data)
      setCurrentTask({ candidate_id: d.candidate_id, task_index: d.task_index, question: d.question, split: d.split })
      setStreamingTaskText('')
    })

    es.addEventListener('task_token', e => {
      const d: { candidate_id: string; task_index: number; token: string } = JSON.parse(e.data)
      setStreamingTaskText(prev => prev + d.token)
    })

    es.addEventListener('task_done', e => {
      const d: { candidate_id: string; task_index: number; question: string; response: string; correct: boolean; formatted: boolean; split: 'feedback' | 'pareto' } = JSON.parse(e.data)
      setCurrentTask(null)
      setEvalEntries(prev => [...prev, {
        candidate_id: d.candidate_id,
        task_index: d.task_index,
        question: d.question,
        response: d.response,
        correct: d.correct,
        formatted: d.formatted,
        split: d.split,
      }])
    })

    es.addEventListener('candidate_scored', e => {
      const d: { candidate_id: string; metrics: Metrics } = JSON.parse(e.data)
      setState(prev => ({
        ...prev,
        candidates: {
          ...prev.candidates,
          [d.candidate_id]: { ...prev.candidates[d.candidate_id], metrics: d.metrics },
        },
      }))
    })

    es.addEventListener('reflect_token', e => {
      const d: { candidate_id: string; token: string } = JSON.parse(e.data)
      setStreamingReflectText(prev => prev + d.token)
    })

    es.addEventListener('child_created', e => {
      const d: { child: Candidate } = JSON.parse(e.data)
      const child = d.child
      if (child.parent_id) {
        if (!pendingChildrenRef.current[child.parent_id]) {
          pendingChildrenRef.current[child.parent_id] = []
        }
        pendingChildrenRef.current[child.parent_id].push(child)
      }
      setState(prev => ({
        ...prev,
        candidates: { ...prev.candidates, [child.id]: child },
      }))
    })

    es.addEventListener('reflect_start', () => {
      setStreamingReflectText('')
    })

    es.addEventListener('reflect_done', e => {
      const d: { candidate_id: string; critique: string; children_ids: string[] } = JSON.parse(e.data)
      setState(prev => {
        const parent = prev.candidates[d.candidate_id]
        const children = (pendingChildrenRef.current[d.candidate_id] ?? [])
        if (parent) {
          // Guard against React StrictMode double-invocation: deduplicate by parent ID
          setReflectGroups(rg =>
            rg.some(g => g.parent.id === d.candidate_id)
              ? rg
              : [...rg, { parent, critique: d.critique, children }]
          )
        }
        return prev
      })
    })

    es.addEventListener('generation_done', e => {
      const d: { generation: number; front_ids: string[]; budget_used: number; budget: number; stop_reason: string | null } = JSON.parse(e.data)
      setState(prev => ({
        ...prev,
        front_ids: d.front_ids,
        generation: d.generation,
        budget_used: d.budget_used,
        budget: d.budget,
        stop_reason: d.stop_reason,
      }))
    })

    es.addEventListener('phase_done', e => {
      const finalState: SessionState = JSON.parse(e.data)
      setState(finalState)
      setRunning(false)
      setCurrentTask(null)
      es.close()
      esRef.current = null
    })

    es.onerror = () => {
      setRunning(false)
      setCurrentTask(null)
      es.close()
      esRef.current = null
    }
  }, [running])

  const stepWithPhase = useCallback(() => {
    step(state.phase)
  }, [step, state.phase])

  return { state, running, evalEntries, currentTask, streamingTaskText, streamingReflectText, reflectGroups, start, step: stepWithPhase }
}
