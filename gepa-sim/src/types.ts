export type Phase =
  | 'idle'
  | 'evaluating_population'
  | 'reflecting'
  | 'evaluating_children'
  | 'selecting'
  | 'done';

export interface Metrics {
  accuracy: number;               // acc@val  — D_pareto, used for Pareto selection
  feedback_accuracy: number;      // acc@fb   — D_feedback, shown to reflection LLM
  feedback_format_rate: number;   // fmt@fb   — D_feedback, shown to reflection LLM
  val_format_rate: number;        // fmt@val  — D_pareto, human observation only
  format_rate: number;            // fmt      — all tasks, aggregate Pareto fallback
  avg_tokens: number;
  instance_scores: number[];      // per-pareto-task: 1.0=correct+fmt, 0.5=correct only, 0.0=wrong
}

export interface Candidate {
  id: string;
  prompt: string;
  parent_id: string | null;
  metrics: Metrics | null;
  note: string | null;
}

export interface SessionState {
  phase: Phase;
  generation: number;
  candidates: Record<string, Candidate>;
  population: string[];
  pending_children: string[];
  front_ids: string[];
  budget_used: number;
  budget: number;
  stop_reason: string | null;
}

export interface EvalEntry {
  candidate_id: string;
  task_index: number;
  question: string;
  response: string;
  correct: boolean;
  formatted: boolean;
  split: 'feedback' | 'pareto';
}

export interface ReflectGroup {
  parent: Candidate;
  critique: string;
  children: Candidate[];
}

export type SsePayload =
  | { type: 'eval_start';       candidate_id: string }
  | { type: 'task_start';       candidate_id: string; task_index: number; question: string; split: 'feedback' | 'pareto' }
  | { type: 'task_done';        candidate_id: string; task_index: number; question: string; response: string; correct: boolean; formatted: boolean; split: 'feedback' | 'pareto' }
  | { type: 'candidate_scored'; candidate_id: string; metrics: Metrics }
  | { type: 'reflect_start';    candidate_id: string }
  | { type: 'reflect_token';    candidate_id: string; token: string }
  | { type: 'reflect_done';     candidate_id: string; critique: string; children_ids: string[] }
  | { type: 'task_token';       candidate_id: string; task_index: number; token: string }
  | { type: 'child_created';    child: Candidate }
  | { type: 'generation_done';  generation: number; front_ids: string[]; budget_used: number; budget: number; stop_reason: string | null }
  | { type: 'phase_done';       state: SessionState };
