# GEPA-style Prompt Evolution Demo (Math + OpenRouter)

This is a **minimal, live-ish demo** you can use in a talk on
"How to optimize anything using LLMs" to illustrate GEPA-style
reflective prompt evolution on a tiny math task.

Core idea:

- Represent the thing you want to optimize (here: a system prompt) as text.
- Define an evaluator that scores behavior on multiple metrics
  (accuracy, format).
- Let an LLM reflect on failures and propose new prompt variants.
- Use a simple evolutionary loop with Pareto selection over metrics.

This mirrors the structure of GEPA's "reflective prompt evolution"
and its `optimize_anything` API.

## Files

- `llm_client.py`
  Minimal OpenRouter chat client using the `chat/completions` endpoint.
  Expects `OPENROUTER_API_KEY` and uses a default model
  (`openai/gpt-4.1-mini`, changeable).

- `gepa_math_demo.py`
  Main demo script:
  - Tiny math dataset
  - System prompt for a math assistant
  - Evaluation function (accuracy, format rate, avg token count)
  - `reflect_and_mutate` using an LLM to propose new system prompts
  - Pareto-front selector over (accuracy, format rate)
  - Matplotlib plot of population per generation

## Setup

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install requests matplotlib
```

Set your OpenRouter API key:

```bash
export OPENROUTER_API_KEY="sk-or-..."  # macOS/Linux
# PowerShell:
#   $Env:OPENROUTER_API_KEY = "sk-or-..."
```


## Running

```bash
python gepa_math_demo.py
```

You should see:

- For each generation:
    - Printed candidates with accuracy and format_rate.
    - A scatterplot (accuracy vs format_rate) for the population.
- After a few generations, some prompts improve both metrics as the
LLM tightens instructions.


## Using with an Agent

You can wrap this demo with any agent framework:

- Outer agent:
    - Decides number of generations.
    - Logs metrics and prompts.
    - Promotes best prompt into your app / opens a PR.
- Inner loop (this repo):
    - `evaluate_prompt` = GEPA-style evaluator.
    - `reflect_and_mutate` = reflective mutation step.
    - `pareto_front` = multi-metric selector.

Swap `TASKS` for your own problems (tool use, RAG, etc.) and adjust the
evaluation accordingly.
