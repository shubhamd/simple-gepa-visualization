# GEPA Math Demo — Run Summary

A walkthrough of one full execution of `gepa_math_demo.py`: a single generation
of reflective prompt evolution against a 2-task math dataset, using
`deepseek/deepseek-v3.2` via OpenRouter.

---

## Setup

| Setting       | Value                                   |
| ------------- | --------------------------------------- |
| Model         | `deepseek/deepseek-v3.2`                |
| Generations   | `1`                                     |
| Tasks         | 2 (`2 + 3`, `7 * 6`)                    |
| Children/parent | `2`                                   |
| Metrics       | `accuracy`, `format_rate`, `avg_tokens` |

### Seed prompt

```text
You are a helpful math assistant.
Solve the following problem step by step.
Finally, output the result on its own line as:
ANSWER: <integer>
```

---

## Step-by-step walkthrough

### Step 1 — Evaluate the seed (Generation 0)

The seed prompt is evaluated against both tasks.

| Candidate | Accuracy | Format rate |
| --------- | :------: | :---------: |
| `seed`    | 1.00     | 1.00        |

> The seed already solves both arithmetic problems and produces the required
> `ANSWER: <integer>` line — there's no failure for the optimizer to fix.

### Step 2 — Re-evaluate parents (start of `one_generation`)

The seed is re-evaluated as part of the optimization loop. Same result.

| Candidate | Accuracy | Format rate |
| --------- | :------: | :---------: |
| `seed`    | 1.00     | 1.00        |

### Step 3 — Reflect & mutate

The reflective LLM is shown the parent prompt + its metrics and asked to
propose two improved variants. It returned **648 characters** containing two
`---PROMPT---` blocks, parsed as:

#### `seed_child1`

```text
You are a skilled math problem solver.
Carefully read the problem, then reason step by step.
Ensure each step is clear and logically follows from the previous.
After completing the reasoning, output only the final answer in this exact format:
ANSWER: <integer>
Do not include any extra text after the answer.
```

**Mutation theme:** emphasizes *clarity of each reasoning step* and forbids
trailing text after the answer.

#### `seed_child2`

```text
You are a precise mathematical assistant.
Solve the given problem systematically:
1. Interpret the question.
2. Perform calculations stepwise.
3. Verify your result.
When finished, write the answer strictly as:
ANSWER: <integer>
No additional characters, explanations, or formatting.
```

**Mutation theme:** introduces a *numbered procedure* (interpret → calculate →
verify) and tightens the post-answer rule.

### Step 4 — Evaluate children

Both children are evaluated against the same 2 tasks.

| Candidate     | Accuracy | Format rate |
| ------------- | :------: | :---------: |
| `seed_child1` | 1.00     | 1.00        |
| `seed_child2` | 1.00     | 1.00        |

### Step 5 — Pareto selection

Combined population: `seed`, `seed_child1`, `seed_child2`.
None dominates any other (all tied at `1.00 / 1.00`), so all three survive.

```
[phase] pareto front: 3/3 kept
```

---

## Lineage tree

```
seed                           acc=1.00 fmt=1.00
├── seed_child1                acc=1.00 fmt=1.00
└── seed_child2                acc=1.00 fmt=1.00
```

---

## Final Pareto front

| Candidate     | Parent | Accuracy | Format rate | Distinguishing quality                            |
| ------------- | ------ | :------: | :---------: | ------------------------------------------------- |
| `seed`        | —      | 1.00     | 1.00        | Concise baseline                                  |
| `seed_child1` | `seed` | 1.00     | 1.00        | Stresses clear, step-by-step reasoning            |
| `seed_child2` | `seed` | 1.00     | 1.00        | Adds a numbered *interpret → calculate → verify* procedure |

---

## Observations

- **The task was too easy.** With only `2 + 3` and `7 * 6`, the seed scores
  perfectly, leaving no signal for the optimizer to drive against. Every
  variant looks equally good on these metrics.
- **The Pareto front is therefore degenerate** — all three candidates tie, so
  none is dominated. With a harder dataset (multi-step word problems,
  intentionally ambiguous formats, mixed difficulty) the front would
  meaningfully separate parents from children.
- **Mutations were qualitative, not corrective.** Because there was nothing to
  fix, the LLM produced *stylistic* variants (clarity rules, numbered
  procedures) rather than targeted repairs. That's expected behavior — GEPA's
  reflective loop adapts to the failure signal it sees, and here it saw none.
- **Token budget wasn't measured against a target.** `avg_tokens` was tracked
  but not used in selection. To get interesting trade-offs, add `avg_tokens`
  (lower-is-better) as a third Pareto dimension and watch concise prompts
  start dominating verbose ones.

---

## Suggested next experiments

1. Replace `TASKS` with a harder set — e.g., word problems, 4–5 digit
   arithmetic, problems where the seed prompt fails the format rule.
2. Bump `generations` to `3`–`5` once the baseline isn't a ceiling.
3. Add `avg_tokens` to the Pareto comparison so brevity is rewarded.
4. Swap the math dataset for tool-use or RAG tasks — the same loop works on
   any text-shaped optimization target.
