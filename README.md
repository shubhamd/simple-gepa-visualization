# GEPA Math Demo — Prompt Evolution Visualizer

A minimal, interactive demo of **GEPA-style reflective prompt evolution** applied to math reasoning.

Two LLMs work together: a local **task model** solves math problems under a candidate system prompt, and a cloud **reflection model** studies the failures and proposes improved prompt variants. A Pareto selector keeps whichever variants are non-dominated on accuracy and format rate. The whole process streams live into a React UI so you can watch the population evolve step by step.

```
┌─────────────┐   SSE stream   ┌──────────────────────┐
│  React UI   │ ◄───────────── │  FastAPI backend      │
│  port 5173  │                │  port 8000            │
└─────────────┘                │                       │
                               │  Task LLM  ──► LM Studio (local)
                               │  Reflect LLM ► OpenRouter (cloud)
                               └──────────────────────┘
```

---

## Prerequisites

| Tool | Purpose |
|------|---------|
| Python 3.12+ | Backend |
| Node.js 20+ | Frontend |
| [LM Studio](https://lmstudio.ai) | Local task model server |
| [OpenRouter](https://openrouter.ai) account + API key | Reflection model |

---

## Setup

### 1. Backend

```bash
cd gepa_math_demo
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt    # fastapi uvicorn sse-starlette requests python-dotenv matplotlib
```

Create `gepa_math_demo/.env` (this file is git-ignored):

```
OPENROUTER_API_KEY=sk-or-...
```

Optional overrides (also in `.env` or exported):

```
LMSTUDIO_BASE_URL=http://localhost:1234/v1   # default
LMSTUDIO_MODEL=mathstral-7b-v0.1            # default — change to whatever you loaded
```

### 3. LM Studio

1. Open LM Studio → **Developer** tab → **Start Server** (default port 1234).
2. Load any instruction-tuned model (the demo was built with `mathstral-7b-v0.1`).
3. Confirm the model ID shown in LM Studio matches `LMSTUDIO_MODEL` in your `.env`.

### 4. Frontend

```bash
cd gepa-sim
npm install
```

---

## Running

Open **two terminals**.

**Terminal 1 — backend:**

```bash
cd gepa_math_demo
source .venv/bin/activate
uvicorn api:app --reload --port 8000
```

You should see startup logs confirming the task model and reflection model:

```
INFO  Task LM  : mathstral-7b-v0.1  (requesting from LM Studio: http://localhost:1234/v1)
INFO  Active in LM Studio: mathstral-7b-v0.1
INFO  Reflection LM: google/gemma-4-26b-a4b-it  (via OpenRouter)
```

**Terminal 2 — frontend:**

```bash
cd gepa-sim
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## Using the UI

The interface has two panels and a control bar at the bottom.

**Left panel — Evolution Tree**  
Shows every candidate prompt as a node. Orange = seed, green = current Pareto front, gray = dominated.
Arrows trace parent → child lineage across generations.

**Right panel** — switches content automatically:
- **Eval log** — during evaluation: shows each task question, the task LLM's full response, and whether it was correct / correctly formatted.
- **Reflection log** — during reflection: streams the reflection LLM's reasoning about failures and the proposed prompt variants.
- **Prompt diff** — after reflection: side-by-side diff of parent vs. child prompts.

**Control bar**

| Button | Action |
|--------|--------|
| **Start** | Initialize a new session with the seed prompt. |
| **Restart** | Tear down and restart from scratch. |
| **Step: \<phase\>** | Run the next phase and stream its events. |

**Phases run in this order each generation:**

```
evaluating_population → reflecting → evaluating_children → selecting → (repeat)
```

Each `Step` call runs exactly one phase, so you can pause and inspect the tree between phases.

---

## Customising

**Change the math tasks** — edit `TASKS` in `gepa_math_demo.py`.

**Change the task model** — set `LMSTUDIO_MODEL` in `.env` and load the matching model in LM Studio.

**Change the reflection model** — set `REFLECTION_MODEL` at the top of `gepa_math_demo.py` to any model slug available on OpenRouter.

**Extend to non-math tasks** — replace `TASKS`, update `parse_answer_line` to score your domain, and adjust the reflection prompt in `session.py:step_reflect`.
