# GEPA Sim — Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the existing `gepa_math_demo/` Python experiment in a minimal, dark-mode React UI where developers step through each GEPA phase manually and watch the prompt tree grow in real time.

**Architecture:** A FastAPI server (`gepa_math_demo/api.py`) owns session state and streams Server-Sent Events (SSE) as each phase runs; the React app (`gepa-sim/`) renders a phase stepper, a live SVG evolution tree, and a prompt diff panel — all driven by the SSE stream. The Python backend reuses existing `llm_client.py` and data models; the React frontend has zero external UI dependencies.

**Tech Stack:** Python — FastAPI, sse-starlette, uvicorn; React 19 + TypeScript 6 + Vite 8; native browser EventSource API for SSE.

---

## Parallelisation guide

| Track | Description | Can start | Blocks |
|-------|-------------|-----------|--------|
| **A** | Python FastAPI backend | Immediately | Track C |
| **B** | React components (mock data) | Immediately | Track C |
| **C** | Integration wiring | After A+B | Ship |

---

## File map

### New / modified in `gepa_math_demo/`

| File | Role |
|------|------|
| `api.py` *(create)* | FastAPI app, CORS, `/session/start`, `/session/step` SSE route, `/session/state` |
| `session.py` *(create)* | `GEPASession` class — owns all mutable state, `step_*` methods that emit events |

### New / modified in `gepa-sim/src/`

| File | Role |
|------|------|
| `types.ts` *(create)* | Shared TS types: `Phase`, `Candidate`, `Metrics`, `SessionState`, `SseEvent` |
| `styles.css` *(create)* | CSS custom properties, layout tokens, dark theme |
| `App.tsx` *(rewrite)* | Shell layout: PhaseBar top, tree center, diff right, control bottom |
| `App.css` *(delete contents)* | Replaced by styles.css |
| `components/PhaseBar.tsx` *(create)* | Horizontal pill stepper, receives `phase: Phase` prop |
| `components/EvolutionTree.tsx` *(create)* | SVG tree, receives `candidates` + `frontIds` props, runs layout algo |
| `components/PromptDiff.tsx` *(create)* | Two-pane LCS line diff, receives `parent` + `child` `Candidate` props |
| `hooks/useSession.ts` *(create)* | Connects to backend: `start()`, `step()`, live `state` and `lastChild` |

---

## Track A — Python FastAPI Backend

### Task A1: Install backend deps and create `api.py` skeleton

**Files:**
- Create: `gepa_math_demo/api.py`

- [ ] **Step 1: Install FastAPI deps into the existing venv**

```bash
cd /Users/sdesale/Desktop/exp/gepa_math_demo
source .venv/bin/activate
pip install fastapi "uvicorn[standard]" sse-starlette
```

Expected: `Successfully installed fastapi-... uvicorn-... sse-starlette-...`

- [ ] **Step 2: Create `api.py` with CORS and health check**

Create `/Users/sdesale/Desktop/exp/gepa_math_demo/api.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="GEPA Sim API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True}
```

- [ ] **Step 3: Verify server starts**

```bash
cd /Users/sdesale/Desktop/exp/gepa_math_demo
source .venv/bin/activate
uvicorn api:app --port 8000 --reload
```

In a second terminal:
```bash
curl http://localhost:8000/health
```
Expected: `{"ok":true}`

- [ ] **Step 4: Commit**

```bash
cd /Users/sdesale/Desktop/exp/gepa_math_demo
git add api.py
git commit -m "feat: FastAPI skeleton with CORS and health check"
```

---

### Task A2: Create `session.py` with `GEPASession` state class

**Files:**
- Create: `gepa_math_demo/session.py`

- [ ] **Step 1: Create `session.py` with the state dataclass**

Create `/Users/sdesale/Desktop/exp/gepa_math_demo/session.py`:

```python
"""Stateful GEPA session — owns all mutable evolution state."""
from __future__ import annotations
import asyncio
from dataclasses import dataclass, field, asdict
from typing import Callable, Any

from gepa_math_demo import (
    Candidate, EvalResult, TASKS, BASE_PROMPT, REFLECTION_MODEL,
    parse_answer_line, pareto_front,
)
from llm_client import call_local_llm, call_openrouter_llm

Emitter = Callable[[str, dict], None]   # (event_name, data) -> None


@dataclass
class GEPASession:
    phase: str = "idle"          # idle | evaluating_population | reflecting | evaluating_children | selecting
    generation: int = 0
    population: list[str] = field(default_factory=list)      # candidate ids
    pending_children: list[str] = field(default_factory=list) # ids not yet in population
    front_ids: list[str] = field(default_factory=list)
    candidates: dict[str, Candidate] = field(default_factory=dict)

    # ── lifecycle ──────────────────────────────────────────────────────────

    def start(self) -> None:
        """Reset to generation 0 with a fresh seed candidate."""
        seed = Candidate(id="seed", prompt=BASE_PROMPT)
        self.candidates = {"seed": seed}
        self.population = ["seed"]
        self.pending_children = []
        self.front_ids = []
        self.generation = 0
        self.phase = "evaluating_population"

    def to_dict(self) -> dict:
        return {
            "phase": self.phase,
            "generation": self.generation,
            "population": self.population,
            "pending_children": self.pending_children,
            "front_ids": self.front_ids,
            "candidates": {
                cid: {
                    "id": c.id,
                    "prompt": c.prompt,
                    "parent_id": c.parent_id,
                    "note": c.note,
                    "metrics": asdict(c.metrics) if c.metrics else None,
                }
                for cid, c in self.candidates.items()
            },
        }

    # ── phase runners ──────────────────────────────────────────────────────

    def step_evaluate_population(self, emit: Emitter) -> None:
        """Evaluate every candidate in self.population."""
        for cid in self.population:
            c = self.candidates[cid]
            emit("eval_start", {"candidate_id": cid})
            correct = 0
            well_formatted = 0
            total_tokens = 0
            for i, t in enumerate(TASKS):
                emit("task_start", {
                    "candidate_id": cid,
                    "task_index": i,
                    "question": t["question"],
                })
                user = f"Problem: {t['question']}\nRemember to follow the required ANSWER format."
                response = call_local_llm(c.prompt, user)
                is_fmt, value = parse_answer_line(response)
                correct += int(value == t["answer"])
                well_formatted += int(is_fmt)
                total_tokens += len(response.split())
                emit("task_done", {
                    "candidate_id": cid,
                    "task_index": i,
                    "correct": value == t["answer"],
                    "formatted": is_fmt,
                })
            n = len(TASKS)
            c.metrics = EvalResult(correct / n, well_formatted / n, total_tokens / n)
            emit("candidate_scored", {
                "candidate_id": cid,
                "metrics": asdict(c.metrics),
            })
        self.phase = "reflecting"

    def step_reflect(self, emit: Emitter) -> None:
        """Generate children for every candidate in self.population."""
        reflection_system = (
            "You are an expert prompt engineer.\n"
            "You will receive a system prompt used for a math QA agent and its evaluation metrics.\n"
            "Suggest strictly better prompt variants that improve accuracy and format adherence.\n"
            "Return each variant as a separate block delimited by ---PROMPT---."
        )
        new_children: list[str] = []
        for cid in self.population:
            c = self.candidates[cid]
            assert c.metrics is not None
            reflection_user = (
                f"Current prompt:\n{c.prompt}\n\n"
                f"Metrics:\n- accuracy: {c.metrics.accuracy:.2f}\n"
                f"- format_rate: {c.metrics.format_rate:.2f}\n"
                f"- avg_tokens: {c.metrics.avg_tokens:.1f}\n\n"
                "Please propose 2 improved system prompt variants."
            )
            emit("reflect_start", {"candidate_id": cid})
            raw = call_openrouter_llm(reflection_system, reflection_user, model=REFLECTION_MODEL)
            blocks = [b.strip() for b in raw.split("---PROMPT---") if b.strip()]
            if not blocks:
                blocks = [
                    c.prompt + "\nIf you do not output exactly 'ANSWER: <integer>' on the last line, your answer will be marked wrong."
                ]
            for i, block in enumerate(blocks[:2]):
                child_id = f"{cid}_child{i + 1}"
                child = Candidate(id=child_id, prompt=block, parent_id=cid, note="LLM reflection-based mutation")
                self.candidates[child_id] = child
                new_children.append(child_id)
                emit("child_created", {
                    "child": {
                        "id": child_id,
                        "prompt": block,
                        "parent_id": cid,
                        "note": child.note,
                        "metrics": None,
                    }
                })
        self.pending_children = new_children
        self.phase = "evaluating_children"

    def step_evaluate_children(self, emit: Emitter) -> None:
        """Evaluate pending children (same as step_evaluate_population but for children)."""
        for cid in self.pending_children:
            c = self.candidates[cid]
            emit("eval_start", {"candidate_id": cid})
            correct = 0
            well_formatted = 0
            total_tokens = 0
            for i, t in enumerate(TASKS):
                emit("task_start", {
                    "candidate_id": cid,
                    "task_index": i,
                    "question": t["question"],
                })
                user = f"Problem: {t['question']}\nRemember to follow the required ANSWER format."
                response = call_local_llm(c.prompt, user)
                is_fmt, value = parse_answer_line(response)
                correct += int(value == t["answer"])
                well_formatted += int(is_fmt)
                total_tokens += len(response.split())
                emit("task_done", {
                    "candidate_id": cid,
                    "task_index": i,
                    "correct": value == t["answer"],
                    "formatted": is_fmt,
                })
            n = len(TASKS)
            c.metrics = EvalResult(correct / n, well_formatted / n, total_tokens / n)
            emit("candidate_scored", {
                "candidate_id": cid,
                "metrics": asdict(c.metrics),
            })
        self.phase = "selecting"

    def step_select(self, emit: Emitter) -> None:
        """Apply Pareto selection, advance to next generation."""
        combined_ids = self.population + self.pending_children
        combined = [self.candidates[cid] for cid in combined_ids]
        front = pareto_front(combined)
        self.population = [c.id for c in front]
        self.front_ids = self.population[:]
        self.pending_children = []
        self.generation += 1
        emit("generation_done", {
            "generation": self.generation,
            "front_ids": self.front_ids,
        })
        self.phase = "evaluating_population"
```

- [ ] **Step 2: Verify imports are clean**

```bash
cd /Users/sdesale/Desktop/exp/gepa_math_demo
source .venv/bin/activate
python -c "from session import GEPASession; s = GEPASession(); s.start(); print(s.to_dict()['phase'])"
```
Expected: `evaluating_population`

- [ ] **Step 3: Commit**

```bash
git add session.py
git commit -m "feat: GEPASession with phased step methods and SSE emitter interface"
```

---

### Task A3: Wire `/session/start`, `/session/state`, and `/session/step` SSE route

**Files:**
- Modify: `gepa_math_demo/api.py`

- [ ] **Step 1: Replace `api.py` with full routing**

Replace the contents of `/Users/sdesale/Desktop/exp/gepa_math_demo/api.py`:

```python
import asyncio
import json
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse

from session import GEPASession

app = FastAPI(title="GEPA Sim API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

session = GEPASession()


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/session/start")
def session_start():
    session.start()
    return JSONResponse(session.to_dict())


@app.get("/session/state")
def session_state():
    return JSONResponse(session.to_dict())


@app.post("/session/step")
async def session_step():
    """Run one phase and stream SSE events as it executes."""

    queue: asyncio.Queue[dict | None] = asyncio.Queue()

    def emit(event: str, data: dict) -> None:
        # Called from a worker thread — put into queue thread-safely.
        loop.call_soon_threadsafe(queue.put_nowait, {"event": event, "data": data})

    def run_phase() -> None:
        phase = session.phase
        if phase == "evaluating_population":
            session.step_evaluate_population(emit)
        elif phase == "reflecting":
            session.step_reflect(emit)
        elif phase == "evaluating_children":
            session.step_evaluate_children(emit)
        elif phase == "selecting":
            session.step_select(emit)
        # Signal stream end
        loop.call_soon_threadsafe(queue.put_nowait, None)

    loop = asyncio.get_event_loop()
    asyncio.get_event_loop().run_in_executor(None, run_phase)

    async def generator():
        while True:
            item = await queue.get()
            if item is None:
                # Send final state then close
                yield {"event": "phase_done", "data": json.dumps(session.to_dict())}
                return
            yield {"event": item["event"], "data": json.dumps(item["data"])}

    return EventSourceResponse(generator())
```

- [ ] **Step 2: Smoke-test the start + state routes**

```bash
# Terminal 1: start server
cd /Users/sdesale/Desktop/exp/gepa_math_demo && source .venv/bin/activate && uvicorn api:app --port 8000 --reload

# Terminal 2
curl -s -X POST http://localhost:8000/session/start | python3 -m json.tool | head -20
curl -s http://localhost:8000/session/state | python3 -m json.tool | grep phase
```
Expected: `"phase": "evaluating_population"`

- [ ] **Step 3: Smoke-test the SSE step route with a short-circuit**

```bash
# This will actually call LM Studio — only run if LM Studio is serving
curl -s -X POST http://localhost:8000/session/step --no-buffer | head -30
```
Expected: lines like `event: task_start\ndata: {"candidate_id": "seed", "task_index": 0, ...}`

- [ ] **Step 4: Commit**

```bash
git add api.py
git commit -m "feat: /session/start, /session/state, /session/step SSE route"
```

---

## Track B — React Frontend (mock data, independent of Track A)

### Task B1: Wipe boilerplate, add layout shell and CSS

**Files:**
- Rewrite: `gepa-sim/src/App.tsx`
- Create: `gepa-sim/src/styles.css`
- Wipe: `gepa-sim/src/App.css`
- Wipe: `gepa-sim/src/index.css`

- [ ] **Step 1: Create `styles.css`**

Create `/Users/sdesale/Desktop/exp/gepa-sim/src/styles.css`:

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --clr-bg:         #0d0d0d;
  --clr-surface:    #141414;
  --clr-border:     #252525;
  --clr-text:       #e2e2e2;
  --clr-muted:      #6b6b6b;
  --clr-seed:       #f97316;
  --clr-front:      #22c55e;
  --clr-dominated:  #6b7280;
  --clr-added:      #166534;
  --clr-removed:    #7f1d1d;
  --radius:         8px;
  --font: 'Inter', system-ui, sans-serif;
}

html, body, #root {
  height: 100%;
  background: var(--clr-bg);
  color: var(--clr-text);
  font-family: var(--font);
  font-size: 14px;
}

.app {
  display: grid;
  grid-template-rows: 56px 1fr 52px;
  grid-template-columns: 1fr 380px;
  grid-template-areas:
    "phase   phase"
    "tree    diff"
    "control control";
  height: 100%;
  gap: 1px;
  background: var(--clr-border);
}

.area-phase   { grid-area: phase;   background: var(--clr-surface); display: flex; align-items: center; padding: 0 24px; }
.area-tree    { grid-area: tree;    background: var(--clr-bg);      overflow: auto; }
.area-diff    { grid-area: diff;    background: var(--clr-surface); overflow: auto; }
.area-control { grid-area: control; background: var(--clr-surface); display: flex; align-items: center; padding: 0 24px; gap: 12px; }

button.step-btn {
  background: var(--clr-text);
  color: var(--clr-bg);
  border: none;
  border-radius: var(--radius);
  padding: 8px 20px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
button.step-btn:disabled { opacity: 0.3; cursor: not-allowed; }
button.step-btn.secondary {
  background: transparent;
  color: var(--clr-text);
  border: 1px solid var(--clr-border);
}

.status-text { color: var(--clr-muted); font-size: 12px; }
```

- [ ] **Step 2: Wipe `App.css` and `index.css`**

Replace `/Users/sdesale/Desktop/exp/gepa-sim/src/App.css` with an empty file.
Replace `/Users/sdesale/Desktop/exp/gepa-sim/src/index.css` with an empty file.

- [ ] **Step 3: Write shell `App.tsx` with static placeholders**

Replace `/Users/sdesale/Desktop/exp/gepa-sim/src/App.tsx`:

```tsx
import './styles.css'

export default function App() {
  return (
    <div className="app">
      <header className="area-phase">
        <span className="status-text">PhaseBar will go here</span>
      </header>
      <main className="area-tree">
        <span className="status-text" style={{ padding: 24, display: 'block' }}>EvolutionTree will go here</span>
      </main>
      <aside className="area-diff">
        <span className="status-text" style={{ padding: 24, display: 'block' }}>PromptDiff will go here</span>
      </aside>
      <footer className="area-control">
        <button className="step-btn secondary">Start</button>
        <button className="step-btn" disabled>Next Step</button>
        <span className="status-text">idle</span>
      </footer>
    </div>
  )
}
```

- [ ] **Step 4: Start dev server and verify layout renders**

```bash
cd /Users/sdesale/Desktop/exp/gepa-sim
source ~/.nvm/nvm.sh && nvm use 22
npm run dev -- --port 5173
```

Open `http://localhost:5173` — expect a dark two-pane layout with placeholder text.

- [ ] **Step 5: Commit**

```bash
cd /Users/sdesale/Desktop/exp/gepa-sim
git add src/styles.css src/App.tsx src/App.css src/index.css
git commit -m "feat: layout shell with dark theme CSS grid"
```

---

### Task B2: TypeScript types

**Files:**
- Create: `gepa-sim/src/types.ts`

- [ ] **Step 1: Create `types.ts`**

Create `/Users/sdesale/Desktop/exp/gepa-sim/src/types.ts`:

```typescript
export type Phase =
  | 'idle'
  | 'evaluating_population'
  | 'reflecting'
  | 'evaluating_children'
  | 'selecting'
  | 'done';

export interface Metrics {
  accuracy: number;
  format_rate: number;
  avg_tokens: number;
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
}

// SSE event payloads ──────────────────────────────────────────────────────

export type SsePayload =
  | { type: 'eval_start';       candidate_id: string }
  | { type: 'task_start';       candidate_id: string; task_index: number; question: string }
  | { type: 'task_done';        candidate_id: string; task_index: number; correct: boolean; formatted: boolean }
  | { type: 'candidate_scored'; candidate_id: string; metrics: Metrics }
  | { type: 'reflect_start';    candidate_id: string }
  | { type: 'child_created';    child: Candidate }
  | { type: 'generation_done';  generation: number; front_ids: string[] }
  | { type: 'phase_done';       state: SessionState }; // always final event in a step
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/sdesale/Desktop/exp/gepa-sim
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: shared TypeScript types matching Python session model"
```

---

### Task B3: `PhaseBar` component

**Files:**
- Create: `gepa-sim/src/components/PhaseBar.tsx`

- [ ] **Step 1: Create directory and component**

```bash
mkdir -p /Users/sdesale/Desktop/exp/gepa-sim/src/components
```

Create `/Users/sdesale/Desktop/exp/gepa-sim/src/components/PhaseBar.tsx`:

```tsx
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
```

- [ ] **Step 2: Smoke-test in `App.tsx` with a mock phase**

Edit `/Users/sdesale/Desktop/exp/gepa-sim/src/App.tsx` — replace the phase placeholder:

```tsx
import './styles.css'
import PhaseBar from './components/PhaseBar'

export default function App() {
  return (
    <div className="app">
      <header className="area-phase">
        <PhaseBar phase="reflecting" generation={0} />
      </header>
      <main className="area-tree">
        <span className="status-text" style={{ padding: 24, display: 'block' }}>EvolutionTree will go here</span>
      </main>
      <aside className="area-diff">
        <span className="status-text" style={{ padding: 24, display: 'block' }}>PromptDiff will go here</span>
      </aside>
      <footer className="area-control">
        <button className="step-btn secondary">Start</button>
        <button className="step-btn" disabled>Next Step</button>
        <span className="status-text">idle</span>
      </footer>
    </div>
  )
}
```

Open `http://localhost:5173` — verify phase pills appear with "Reflect" highlighted.

- [ ] **Step 3: Commit**

```bash
cd /Users/sdesale/Desktop/exp/gepa-sim
git add src/components/PhaseBar.tsx src/App.tsx
git commit -m "feat: PhaseBar component with active/done state styling"
```

---

### Task B4: `EvolutionTree` SVG component

**Files:**
- Create: `gepa-sim/src/components/EvolutionTree.tsx`

- [ ] **Step 1: Create component**

Create `/Users/sdesale/Desktop/exp/gepa-sim/src/components/EvolutionTree.tsx`:

```tsx
import type { Candidate } from '../types'

const ROW_H = 140
const NODE_R = 26
const CELL_W = 200
const PAD_TOP = 50
const PAD_LEFT = 40

interface Pos { x: number; y: number }

function buildLayout(
  candidates: Record<string, Candidate>
): Record<string, Pos> {
  const roots = Object.values(candidates).filter(c => c.parent_id === null)
  const positions: Record<string, Pos> = {}

  function layout(node: Candidate, depth: number, xLo: number, xHi: number) {
    const x = (xLo + xHi) / 2
    const y = depth * ROW_H + NODE_R + PAD_TOP
    positions[node.id] = { x: x + PAD_LEFT, y }
    const children = Object.values(candidates).filter(c => c.parent_id === node.id)
    if (children.length === 0) return
    const sliceW = (xHi - xLo) / children.length
    children.forEach((child, i) => {
      layout(child, depth + 1, xLo + i * sliceW, xLo + (i + 1) * sliceW)
    })
  }

  roots.forEach((root, i) => layout(root, 0, i * CELL_W, (i + 1) * CELL_W))
  return positions
}

function nodeColor(c: Candidate, frontIds: Set<string>): string {
  if (!c.parent_id) return 'var(--clr-seed)'
  if (frontIds.has(c.id)) return 'var(--clr-front)'
  return 'var(--clr-dominated)'
}

function metricsLabel(c: Candidate): string {
  if (!c.metrics) return 'evaluating…'
  return `acc ${(c.metrics.accuracy * 100).toFixed(0)}%  fmt ${(c.metrics.format_rate * 100).toFixed(0)}%`
}

export default function EvolutionTree({
  candidates,
  frontIds,
}: {
  candidates: Record<string, Candidate>
  frontIds: Set<string>
}) {
  const positions = buildLayout(candidates)
  const allPos = Object.values(positions)

  const maxX = allPos.length ? Math.max(...allPos.map(p => p.x)) + CELL_W / 2 + PAD_LEFT : 400
  const maxY = allPos.length ? Math.max(...allPos.map(p => p.y)) + ROW_H : 300

  return (
    <svg
      viewBox={`0 0 ${maxX} ${maxY}`}
      width="100%"
      style={{ display: 'block', minHeight: 200 }}
    >
      {/* Edges */}
      {Object.values(candidates).map(c => {
        if (!c.parent_id) return null
        const from = positions[c.parent_id]
        const to   = positions[c.id]
        if (!from || !to) return null
        return (
          <line
            key={`edge-${c.id}`}
            x1={from.x} y1={from.y}
            x2={to.x}   y2={to.y}
            stroke="var(--clr-border)"
            strokeWidth={1.5}
          />
        )
      })}

      {/* Nodes */}
      {Object.values(candidates).map(c => {
        const pos = positions[c.id]
        if (!pos) return null
        const color = nodeColor(c, frontIds)
        const firstLine = c.prompt.trim().split('\n')[0].slice(0, 40)
        return (
          <g key={c.id} style={{ cursor: 'default' }}>
            <circle cx={pos.x} cy={pos.y} r={NODE_R} fill={color} opacity={0.9} />
            {/* id label */}
            <text
              x={pos.x} y={pos.y - 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={9}
              fontWeight={700}
              fill="var(--clr-bg)"
            >
              {c.id.length > 12 ? c.id.slice(-8) : c.id}
            </text>
            {/* metrics label below circle */}
            <text
              x={pos.x} y={pos.y + NODE_R + 14}
              textAnchor="middle"
              fontSize={10}
              fill="var(--clr-muted)"
            >
              {metricsLabel(c)}
            </text>
            {/* prompt snippet */}
            <text
              x={pos.x} y={pos.y + NODE_R + 28}
              textAnchor="middle"
              fontSize={9}
              fill="var(--clr-muted)"
              opacity={0.7}
            >
              {firstLine}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
```

- [ ] **Step 2: Add mock data preview in `App.tsx`**

Replace the tree placeholder in `App.tsx`:

```tsx
import './styles.css'
import PhaseBar from './components/PhaseBar'
import EvolutionTree from './components/EvolutionTree'
import type { Candidate } from './types'

const MOCK_CANDIDATES: Record<string, Candidate> = {
  seed: { id: 'seed', prompt: 'You are a helpful math assistant.\nSolve step by step.\nANSWER: <integer>', parent_id: null, metrics: { accuracy: 0.67, format_rate: 1.0, avg_tokens: 45 }, note: null },
  seed_child1: { id: 'seed_child1', prompt: 'You are a skilled math solver.\nReason step by step.\nOutput exactly: ANSWER: <integer>', parent_id: 'seed', metrics: { accuracy: 1.0, format_rate: 1.0, avg_tokens: 52 }, note: 'LLM mutation' },
  seed_child2: { id: 'seed_child2', prompt: 'You are precise.\n1. Interpret.\n2. Calculate.\n3. Verify.\nANSWER: <integer>', parent_id: 'seed', metrics: null, note: 'LLM mutation' },
}

export default function App() {
  return (
    <div className="app">
      <header className="area-phase">
        <PhaseBar phase="evaluating_children" generation={0} />
      </header>
      <main className="area-tree">
        <EvolutionTree
          candidates={MOCK_CANDIDATES}
          frontIds={new Set(['seed_child1'])}
        />
      </main>
      <aside className="area-diff">
        <span className="status-text" style={{ padding: 24, display: 'block' }}>PromptDiff will go here</span>
      </aside>
      <footer className="area-control">
        <button className="step-btn secondary">Start</button>
        <button className="step-btn">Next Step</button>
        <span className="status-text">evaluating_children</span>
      </footer>
    </div>
  )
}
```

Open `http://localhost:5173` — verify SVG tree shows seed → two children with colored circles and metric labels.

- [ ] **Step 3: Commit**

```bash
cd /Users/sdesale/Desktop/exp/gepa-sim
git add src/components/EvolutionTree.tsx src/App.tsx
git commit -m "feat: SVG EvolutionTree with recursive layout, colored nodes, metric labels"
```

---

### Task B5: `PromptDiff` component

**Files:**
- Create: `gepa-sim/src/components/PromptDiff.tsx`

- [ ] **Step 1: Create component with LCS line diff**

Create `/Users/sdesale/Desktop/exp/gepa-sim/src/components/PromptDiff.tsx`:

```tsx
import type { Candidate } from '../types'

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
      result.unshift({ text: a[i-1], kind: 'same' })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      result.unshift({ text: b[j-1], kind: 'added' })
      j--
    } else {
      result.unshift({ text: a[i-1], kind: 'removed' })
      i--
    }
  }
  return result
}

const BG: Record<DiffKind, string> = {
  same:    'transparent',
  added:   'rgba(34,197,94,0.12)',
  removed: 'rgba(239,68,68,0.12)',
}
const CLR: Record<DiffKind, string> = {
  same:    'var(--clr-text)',
  added:   '#86efac',
  removed: '#fca5a5',
}

function DiffPane({ lines, title }: { lines: DiffLine[]; title: string }) {
  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--clr-muted)', borderBottom: '1px solid var(--clr-border)' }}>
        {title}
      </div>
      <pre style={{ margin: 0, padding: '12px 16px', fontSize: 12, lineHeight: 1.7, fontFamily: 'monospace' }}>
        {lines.map((l, idx) => (
          <div key={idx} style={{ background: BG[l.kind], color: CLR[l.kind], borderRadius: 2, padding: '0 2px' }}>
            {l.kind === 'added'   ? '+ ' : l.kind === 'removed' ? '- ' : '  '}
            {l.text || ' '}
          </div>
        ))}
      </pre>
    </div>
  )
}

export default function PromptDiff({
  parent,
  child,
}: {
  parent: Candidate | null
  child: Candidate | null
}) {
  if (!parent || !child) {
    return (
      <div style={{ padding: 24, color: 'var(--clr-muted)', fontSize: 12 }}>
        Prompt diff appears here when a child is created.
      </div>
    )
  }

  const parentLines = parent.prompt.split('\n')
  const childLines  = child.prompt.split('\n')
  const diff = diffLines(parentLines, childLines)

  const parentView = diff.filter(l => l.kind !== 'added')
  const childView  = diff.filter(l => l.kind !== 'removed')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--clr-border)' }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Prompt diff</div>
        <div style={{ fontSize: 11, color: 'var(--clr-muted)', marginTop: 2 }}>
          {parent.id} → {child.id}
        </div>
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <DiffPane lines={parentView} title={parent.id} />
        <div style={{ width: 1, background: 'var(--clr-border)' }} />
        <DiffPane lines={childView}  title={child.id} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add mock diff preview in `App.tsx`**

Update `App.tsx` to include PromptDiff with the mock candidates:

```tsx
import './styles.css'
import PhaseBar from './components/PhaseBar'
import EvolutionTree from './components/EvolutionTree'
import PromptDiff from './components/PromptDiff'
import type { Candidate } from './types'

const MOCK_CANDIDATES: Record<string, Candidate> = {
  seed: { id: 'seed', prompt: 'You are a helpful math assistant.\nSolve step by step.\nANSWER: <integer>', parent_id: null, metrics: { accuracy: 0.67, format_rate: 1.0, avg_tokens: 45 }, note: null },
  seed_child1: { id: 'seed_child1', prompt: 'You are a skilled math solver.\nReason step by step.\nDo not include extra text.\nOutput exactly: ANSWER: <integer>', parent_id: 'seed', metrics: { accuracy: 1.0, format_rate: 1.0, avg_tokens: 52 }, note: 'LLM mutation' },
  seed_child2: { id: 'seed_child2', prompt: 'You are precise.\n1. Interpret.\n2. Calculate.\n3. Verify.\nANSWER: <integer>', parent_id: 'seed', metrics: null, note: 'LLM mutation' },
}

export default function App() {
  return (
    <div className="app">
      <header className="area-phase">
        <PhaseBar phase="evaluating_children" generation={0} />
      </header>
      <main className="area-tree">
        <EvolutionTree
          candidates={MOCK_CANDIDATES}
          frontIds={new Set(['seed_child1'])}
        />
      </main>
      <aside className="area-diff">
        <PromptDiff
          parent={MOCK_CANDIDATES['seed']}
          child={MOCK_CANDIDATES['seed_child1']}
        />
      </aside>
      <footer className="area-control">
        <button className="step-btn secondary">Start</button>
        <button className="step-btn">Next Step</button>
        <span className="status-text">evaluating_children</span>
      </footer>
    </div>
  )
}
```

Open `http://localhost:5173` — verify diff pane shows two columns with green/red line highlights.

- [ ] **Step 3: Commit**

```bash
cd /Users/sdesale/Desktop/exp/gepa-sim
git add src/components/PromptDiff.tsx src/App.tsx
git commit -m "feat: PromptDiff with LCS line diff and two-pane layout"
```

---

## Track C — Integration (requires Track A + Track B complete)

### Task C1: `useSession` hook

**Files:**
- Create: `gepa-sim/src/hooks/useSession.ts`

- [ ] **Step 1: Create directory and hook**

```bash
mkdir -p /Users/sdesale/Desktop/exp/gepa-sim/src/hooks
```

Create `/Users/sdesale/Desktop/exp/gepa-sim/src/hooks/useSession.ts`:

```typescript
import { useState, useRef, useCallback } from 'react'
import type { SessionState, SsePayload, Candidate } from '../types'

const API = 'http://localhost:8000'

const EMPTY_STATE: SessionState = {
  phase: 'idle',
  generation: 0,
  candidates: {},
  population: [],
  pending_children: [],
  front_ids: [],
}

export function useSession() {
  const [state, setState]         = useState<SessionState>(EMPTY_STATE)
  const [running, setRunning]     = useState(false)
  const [lastChild, setLastChild] = useState<{ parent: Candidate; child: Candidate } | null>(null)
  const esRef = useRef<EventSource | null>(null)

  const start = useCallback(async () => {
    const res = await fetch(`${API}/session/start`, { method: 'POST' })
    const data: SessionState = await res.json()
    setState(data)
    setLastChild(null)
  }, [])

  const step = useCallback(() => {
    if (running) return
    setRunning(true)

    const es = new EventSource(`${API}/session/step`)   // Vite proxies POST→GET; we use GET-compatible SSE here
    esRef.current = es

    es.addEventListener('task_start', e => {
      const payload: Extract<SsePayload, { type: 'task_start' }> = JSON.parse(e.data)
      console.log('[task_start]', payload.candidate_id, payload.task_index)
    })

    es.addEventListener('candidate_scored', e => {
      const payload: Extract<SsePayload, { type: 'candidate_scored' }> = JSON.parse(e.data)
      setState(prev => ({
        ...prev,
        candidates: {
          ...prev.candidates,
          [payload.candidate_id]: {
            ...prev.candidates[payload.candidate_id],
            metrics: payload.metrics,
          },
        },
      }))
    })

    es.addEventListener('child_created', e => {
      const payload: Extract<SsePayload, { type: 'child_created' }> = JSON.parse(e.data)
      const child = payload.child
      setState(prev => {
        const parent = prev.candidates[child.parent_id!]
        if (parent) setLastChild({ parent, child })
        return {
          ...prev,
          candidates: { ...prev.candidates, [child.id]: child },
        }
      })
    })

    es.addEventListener('generation_done', e => {
      const payload: Extract<SsePayload, { type: 'generation_done' }> = JSON.parse(e.data)
      setState(prev => ({ ...prev, front_ids: payload.front_ids }))
    })

    es.addEventListener('phase_done', e => {
      const finalState: SessionState = JSON.parse(e.data)
      setState(finalState)
      setRunning(false)
      es.close()
    })

    es.onerror = () => {
      setRunning(false)
      es.close()
    }
  }, [running])

  return { state, running, lastChild, start, step }
}
```

> **Note on SSE + POST:** The EventSource API only supports GET. The backend `/session/step` is a POST. Add a Vite proxy and change the backend route to GET for the SSE stream (the session state already knows which phase to run).

- [ ] **Step 2: Change `/session/step` in `api.py` from POST to GET**

In `/Users/sdesale/Desktop/exp/gepa_math_demo/api.py`, change:
```python
@app.post("/session/step")
```
to:
```python
@app.get("/session/step")
```

- [ ] **Step 3: Add Vite proxy to forward `/api/*` to the backend**

Edit `/Users/sdesale/Desktop/exp/gepa-sim/vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/session': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
```

Update `API` constant in `useSession.ts` from `'http://localhost:8000'` to `''` (empty string, so requests go to `/session/...` on same host, proxied by Vite).

- [ ] **Step 4: Commit**

```bash
cd /Users/sdesale/Desktop/exp/gepa-sim
git add src/hooks/useSession.ts vite.config.ts
git commit -m "feat: useSession hook with SSE event handlers and Vite proxy"

cd /Users/sdesale/Desktop/exp/gepa_math_demo
git add api.py
git commit -m "fix: change /session/step to GET for EventSource compatibility"
```

---

### Task C2 + C3: Wire `App.tsx` to live session

**Files:**
- Rewrite: `gepa-sim/src/App.tsx`

- [ ] **Step 1: Replace `App.tsx` with fully wired version**

Replace `/Users/sdesale/Desktop/exp/gepa-sim/src/App.tsx`:

```tsx
import './styles.css'
import PhaseBar from './components/PhaseBar'
import EvolutionTree from './components/EvolutionTree'
import PromptDiff from './components/PromptDiff'
import { useSession } from './hooks/useSession'

export default function App() {
  const { state, running, lastChild, start, step } = useSession()

  const isIdle    = state.phase === 'idle'
  const canStep   = !isIdle && !running
  const frontIds  = new Set(state.front_ids)

  return (
    <div className="app">
      <header className="area-phase">
        <PhaseBar phase={state.phase} generation={state.generation} />
      </header>

      <main className="area-tree">
        <EvolutionTree candidates={state.candidates} frontIds={frontIds} />
      </main>

      <aside className="area-diff">
        <PromptDiff
          parent={lastChild?.parent ?? null}
          child={lastChild?.child ?? null}
        />
      </aside>

      <footer className="area-control">
        <button className="step-btn secondary" onClick={start} disabled={running}>
          {isIdle ? 'Start' : 'Restart'}
        </button>
        <button className="step-btn" onClick={step} disabled={!canStep}>
          {running ? 'Running…' : `Step: ${state.phase.replace(/_/g, ' ')}`}
        </button>
        <span className="status-text">
          {running ? '⏳ working…' : `${Object.keys(state.candidates).length} candidates`}
        </span>
      </footer>
    </div>
  )
}
```

- [ ] **Step 2: End-to-end test**

Ensure both servers are running:
```bash
# Terminal 1 — Python backend
cd /Users/sdesale/Desktop/exp/gepa_math_demo && source .venv/bin/activate && uvicorn api:app --port 8000 --reload

# Terminal 2 — React dev server
cd /Users/sdesale/Desktop/exp/gepa-sim && source ~/.nvm/nvm.sh && nvm use 22 && npm run dev -- --port 5173
```

1. Open `http://localhost:5173`
2. Click **Start** — phase bar should show "Evaluate" as active
3. Click **Step: evaluating population** — tree node should appear for "seed", metrics fill in as tasks complete
4. Click **Step: reflecting** — two children appear, diff panel populates
5. Click **Step: score children** — child nodes get metrics
6. Click **Step: selecting** — front IDs update, generation increments

- [ ] **Step 3: Final commit**

```bash
cd /Users/sdesale/Desktop/exp/gepa-sim
git add src/App.tsx
git commit -m "feat: wire App to useSession — live tree, diff, phase bar, step button"
```

---

## Completion checklist

- [ ] Track A: Backend serves SSE events for all 4 phases
- [ ] Track B: All 3 UI components render correctly on mock data
- [ ] Track C: Start button resets session; Next Step button advances phase; tree updates live; diff populates on first child_created
- [ ] No external UI libraries added
- [ ] Both servers start cleanly from a fresh terminal

---

## Status tracker

| Task | Owner | Status |
|------|-------|--------|
| A1 — FastAPI skeleton | — | ⬜ todo |
| A2 — GEPASession class | — | ⬜ todo |
| A3 — SSE step route | — | ⬜ todo |
| B1 — Layout shell + CSS | — | ⬜ todo |
| B2 — TypeScript types | — | ⬜ todo |
| B3 — PhaseBar | — | ⬜ todo |
| B4 — EvolutionTree | — | ⬜ todo |
| B5 — PromptDiff | — | ⬜ todo |
| C1 — useSession hook | — | ⬜ todo |
| C2+C3 — App wiring | — | ⬜ todo |
