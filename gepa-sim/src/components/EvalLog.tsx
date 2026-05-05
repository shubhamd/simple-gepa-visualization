import { useEffect, useRef } from 'react'
import type { EvalEntry } from '../types'

function SplitBadge({ split }: { split: 'feedback' | 'pareto' }) {
  const isFb = split === 'feedback'
  return (
    <span style={{
      fontSize: 10, fontWeight: 600,
      color: isFb ? '#a78bfa' : '#38bdf8',
      background: isFb ? 'rgba(167,139,250,0.12)' : 'rgba(56,189,248,0.12)',
      padding: '2px 6px', borderRadius: 10,
    }}>
      {isFb ? '🔍 train' : '✦ val'}
    </span>
  )
}

function ResponseBlock({ question, response, correct }: { question: string; response: string; correct: boolean }) {
  const lines = response.split('\n')
  return (
    <pre style={{
      margin: '6px 0 0',
      padding: '10px 12px',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid var(--clr-border)',
      borderRadius: 6,
      fontSize: 12,
      lineHeight: 1.7,
      fontFamily: 'monospace',
      overflowX: 'auto',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }}>
      <div style={{
        fontWeight: 700,
        color: '#c9d1d9',
        marginBottom: 6,
        paddingBottom: 6,
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        fontFamily: 'inherit',
        fontSize: 12,
      }}>
        {question}
      </div>
      {lines.map((line, i) => {
        const startsAnswer   = line.trimStart().startsWith('ANSWER:')
        const containsAnswer = !startsAnswer && line.includes('ANSWER:')
        const clr = startsAnswer   ? (correct ? '#4ade80' : '#f87171')
                  : containsAnswer ? '#fbbf24'
                  : 'var(--clr-text)'
        const bg  = startsAnswer   ? (correct ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)')
                  : containsAnswer ? 'rgba(251,191,36,0.08)'
                  : 'transparent'
        const hl  = startsAnswer || containsAnswer
        return (
          <div key={i} style={{
            color: clr, fontWeight: hl ? 700 : 400,
            background: bg, borderRadius: hl ? 3 : 0,
            padding: hl ? '1px 4px' : '0', marginLeft: hl ? -4 : 0,
          }}>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

function EntryCard({ entry, taskCount }: { entry: EvalEntry; taskCount: number }) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--clr-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--clr-muted)', fontFamily: 'monospace' }}>
          {entry.candidate_id}
        </span>
        <span style={{ fontSize: 11, color: 'var(--clr-muted)' }}>
          task {entry.task_index + 1}/{taskCount}
        </span>
        <SplitBadge split={entry.split} />
      </div>
      <ResponseBlock question={entry.question} response={entry.response} correct={entry.correct} />
      <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
        <span style={{
          fontSize: 10, fontWeight: 600,
          color: entry.correct ? '#4ade80' : '#f87171',
          background: entry.correct ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
          padding: '2px 7px', borderRadius: 10,
        }}>
          {entry.correct ? '✓ correct' : '✗ wrong'}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 600,
          color: entry.formatted ? '#60a5fa' : '#fbbf24',
          background: entry.formatted ? 'rgba(96,165,250,0.12)' : 'rgba(251,191,36,0.12)',
          padding: '2px 7px', borderRadius: 10,
        }}>
          {entry.formatted ? '✓ fmt' : '✗ fmt'}
        </span>
      </div>
    </div>
  )
}

function PulsingTask({ candidateId, taskIndex, question, taskCount, split, streamText }: {
  candidateId: string; taskIndex: number; question: string; taskCount: number
  split: 'feedback' | 'pareto'; streamText: string
}) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--clr-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--clr-muted)', fontFamily: 'monospace' }}>
          {candidateId}
        </span>
        <span style={{ fontSize: 11, color: 'var(--clr-muted)' }}>
          task {taskIndex + 1}/{taskCount}
        </span>
        <SplitBadge split={split} />
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--clr-muted)', animation: 'pulse 1.2s ease-in-out infinite' }}>
          streaming…
        </span>
      </div>
      {streamText ? (
        <pre style={{
          margin: 0, padding: '10px 12px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid var(--clr-border)',
          borderRadius: 6, fontSize: 12, lineHeight: 1.7,
          fontFamily: 'monospace', color: 'var(--clr-text)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          overflowX: 'hidden',
        }}>
          <div style={{
            fontWeight: 700, color: '#c9d1d9', marginBottom: 6,
            paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.08)',
            fontFamily: 'inherit', fontSize: 12,
          }}>
            {question}
          </div>
          {streamText}<span style={{ animation: 'blink 1s steps(1) infinite', opacity: 1 }}>▌</span>
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

export default function EvalLog({ entries, currentTask, taskCount, streamingText }: {
  entries: EvalEntry[]
  currentTask: { candidate_id: string; task_index: number; question: string; split: 'feedback' | 'pareto' } | null
  taskCount: number
  streamingText: string
}) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries.length, currentTask])

  const isEmpty = entries.length === 0 && !currentTask

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--clr-border)',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Eval output</span>
        {(entries.length > 0 || currentTask) && (
          <span style={{ fontSize: 11, color: 'var(--clr-muted)' }}>
            {entries.length} done{currentTask ? ', 1 running' : ''}
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--clr-muted)' }}>
          <span style={{ color: '#a78bfa' }}>🔍 train</span> = training &nbsp;
          <span style={{ color: '#38bdf8' }}>✦ val</span> = held-out
        </span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {isEmpty && (
          <div style={{ padding: 24, color: 'var(--clr-muted)', fontSize: 12 }}>
            Evaluation output appears here task by task.
          </div>
        )}
        {entries.map((entry, i) => (
          <EntryCard key={`${entry.candidate_id}-${entry.task_index}-${i}`} entry={entry} taskCount={taskCount} />
        ))}
        {currentTask && (
          <PulsingTask
            candidateId={currentTask.candidate_id}
            taskIndex={currentTask.task_index}
            question={currentTask.question}
            taskCount={taskCount}
            split={currentTask.split}
            streamText={streamingText}
          />
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
