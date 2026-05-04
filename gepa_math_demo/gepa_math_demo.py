"""GEPA-style math prompt evolution demo using OpenRouter.

This is a minimal, educational example:
- Defines a tiny math dataset
- Uses an LLM via OpenRouter as the "agent"
- Evolves system prompts with a simple reflective loop
- Plots a Pareto-ish front over generations
"""
import re
from dataclasses import dataclass, field
from typing import List, Dict
import matplotlib.pyplot as plt

from llm_client import call_local_llm, call_openrouter_llm

REFLECTION_MODEL = "google/gemma-4-26b-a4b-it"

ALL_CANDIDATES: dict[str, "Candidate"] = {}

TASKS: List[Dict] = [
    # D_feedback: shown to the reflection LLM as failure traces (ASI)
    {"question": "What is 7 * 6?",                              "answer": 42, "split": "feedback"},
    {"question": "What is 10 / 2 * 3 - 9?",                    "answer": 6,  "split": "feedback"},
    {
        "question": (
            "A rectangle has a length that is 3 times its width. "
            "If the perimeter is 48, what is the width as a whole number?"
        ),
        "answer": 6,   # 2(w + 3w) = 48 → 8w = 48 → w = 6
        "split": "feedback",
    },
    # D_pareto: held-out tasks used only for Pareto acceptance, never shown to the reflection LLM
    {
        "question": (
            "Mark rows downstream for 30 km, then turns around and returns to his original location. "
            "The total trip took 8 hr. If the current flows at 2 km/h, "
            "how fast would Mark row in still water? Give the answer as a whole number."
        ),
        "answer": 8,
        "split": "pareto",
    },
    {
        "question": (
            "Sally is 20 years older than Joey. "
            "The product of their current ages is 175 more than the product of their ages 5 years ago. "
            "What is Sally's current age?"
        ),
        "answer": 30,  # Joey=10, Sally=30: 300 - 125 = 175
        "split": "pareto",
    },
]

BASE_PROMPT = """You are a helpful math assistant.
Solve the following problem step by step.
Finally, output the result on its own line as:
ANSWER: <integer>
"""


@dataclass
class EvalResult:
    accuracy: float               # D_pareto — acc@val: used for Pareto selection
    feedback_accuracy: float      # D_feedback — acc@fb: used for reflection context
    feedback_format_rate: float   # D_feedback — fmt@fb: shown to reflection LLM
    val_format_rate: float        # D_pareto — fmt@val: for human observation only
    format_rate: float            # all tasks — kept for aggregate Pareto fallback
    avg_tokens: float
    instance_scores: list[float] = field(default_factory=list)  # per-pareto-task: 1.0=correct+fmt, 0.5=correct only, 0.0=wrong


@dataclass
class Candidate:
    id: str
    prompt: str
    metrics: EvalResult | None = None
    parent_id: str | None = None
    note: str | None = None


def _indent(text: str, prefix: str = "    | ") -> str:
    return "\n".join(prefix + line for line in text.splitlines())


def parse_response(response: str, expected: int) -> tuple[bool, bool]:
    """Return (formatted, correct) as independent signals.

    formatted: last non-empty line is exactly 'ANSWER: <integer>'
    correct:   the expected integer is the model's answer, regardless of formatting.
               Falls back to finding it as the last integer anywhere in the response.
    """
    lines = [l.strip() for l in response.strip().splitlines() if l.strip()]
    last = lines[-1] if lines else ""

    formatted = False
    formatted_value: int | None = None
    if last.startswith("ANSWER:"):
        try:
            formatted_value = int(last.split("ANSWER:", 1)[1].strip())
            formatted = True
        except ValueError:
            pass

    if formatted_value is not None:
        correct = formatted_value == expected
    else:
        # Fallback: last integer found anywhere in the response
        all_ints = re.findall(r"-?\b\d+\b", response)
        correct = bool(all_ints) and int(all_ints[-1]) == expected

    return formatted, correct


# Legacy alias used by old CLI code
def parse_answer_line(response: str) -> tuple[bool, int | None]:
    lines = [l.strip() for l in response.strip().splitlines() if l.strip()]
    last = lines[-1] if lines else ""
    if last.startswith("ANSWER:"):
        try:
            return True, int(last.split("ANSWER:", 1)[1].strip())
        except ValueError:
            return False, None
    return False, None


def run_model(prompt: str, question: str) -> str:
    system = prompt
    user = f"Problem: {question}\nRemember to follow the required ANSWER format."
    return call_local_llm(system, user)


def evaluate_prompt(prompt: str, tasks=TASKS) -> EvalResult:
    pareto_correct = 0
    feedback_correct = 0
    well_formatted = 0
    feedback_well_formatted = 0
    val_well_formatted = 0
    total_tokens = 0
    pareto_instance_scores: list[bool] = []

    n_pareto   = sum(1 for t in tasks if t.get("split") == "pareto")
    n_feedback = sum(1 for t in tasks if t.get("split") == "feedback")

    for i, t in enumerate(tasks, 1):
        print(f"    eval task {i}/{len(tasks)} [{t.get('split','?')}]: {t['question']!r}", flush=True)
        response = run_model(prompt, t["question"])
        is_fmt, is_correct = parse_response(response, t["answer"])
        if is_fmt:
            well_formatted += 1
            if t.get("split") == "feedback":
                feedback_well_formatted += 1
            else:
                val_well_formatted += 1
        if is_correct:
            if t.get("split") == "pareto":
                pareto_correct += 1
            else:
                feedback_correct += 1
        if t.get("split") == "pareto":
            pareto_instance_scores.append(
                1.0 if is_correct and is_fmt else (0.5 if is_correct else 0.0)
            )
        total_tokens += len(response.split())

    n = len(tasks)
    return EvalResult(
        accuracy=pareto_correct / n_pareto if n_pareto else 0.0,
        feedback_accuracy=feedback_correct / n_feedback if n_feedback else 0.0,
        feedback_format_rate=feedback_well_formatted / n_feedback if n_feedback else 0.0,
        val_format_rate=val_well_formatted / n_pareto if n_pareto else 0.0,
        format_rate=well_formatted / n,
        avg_tokens=total_tokens / n,
        instance_scores=pareto_instance_scores,
    )


def evaluate_population(population: list[Candidate]) -> None:
    for c in population:
        print(f"  evaluating {c.id}...", flush=True)
        c.metrics = evaluate_prompt(c.prompt)
        ALL_CANDIDATES[c.id] = c
        print(
            f"  -> {c.id} acc={c.metrics.accuracy:.2f} "
            f"fmt={c.metrics.format_rate:.2f}",
            flush=True,
        )


def reflect_and_mutate(candidate: Candidate, num_children: int = 2,
                       task_traces: list[dict] | None = None) -> list[Candidate]:
    """Reflect on candidate metrics + optional task traces, propose improved prompts."""
    import json as _json
    assert candidate.metrics is not None

    reflection_system = """You are an expert prompt engineer evaluating a math QA agent's system prompt.

Respond with ONLY valid JSON in this exact structure — no markdown, no code fences, no extra text:
{
  "analysis": "Your critique of what is failing and why, in plain English",
  "prompts": [
    "First improved system prompt — the full text that will be sent directly to the math model. No analysis, no commentary here.",
    "Second improved system prompt — similarly clean."
  ]
}

Critical rules for the prompts array entries:
- Each string is the COMPLETE system prompt that will be fed verbatim to the math model.
- Do NOT include reasoning, explanation, or meta-commentary inside the prompts strings.
- Do NOT start a prompt with "To improve..." or "This prompt...".
- End each prompt with the exact output format instruction: ANSWER: <integer>
"""

    # ASI: only feedback-task failures exposed to the reflection LLM
    if task_traces:
        failed = [r for r in task_traces if not r["correct"] and r.get("split") == "feedback"]
        if failed:
            asi_lines = ["\nFailed task execution traces (diagnose what went wrong):"]
            for r in failed:
                asi_lines.append(
                    f"\n  Task: {r['question']}\n"
                    f"  Model output: {r['response'].strip()[:400]}\n"
                    f"  Expected: {r['expected']}\n"
                    f"  Formatted correctly: {r['formatted']}"
                )
            asi = "\n".join(asi_lines) + "\n"
        else:
            asi = "\nAll feedback tasks passed — look for opportunities to improve format consistency or brevity.\n"
    else:
        asi = ""

    reflection_user = (
        f"Current prompt:\n{candidate.prompt}\n\n"
        f"Evaluation metrics (D_feedback tasks only — held-out validation tasks are not shown):\n"
        f"- feedback_accuracy: {candidate.metrics.feedback_accuracy:.2f}  ({int(candidate.metrics.feedback_accuracy * 100)}% correct on training tasks)\n"
        f"- format_rate: {candidate.metrics.feedback_format_rate:.2f}  ({int(candidate.metrics.feedback_format_rate * 100)}% follow ANSWER: <integer>)\n"
        f"- avg_tokens: {candidate.metrics.avg_tokens:.1f}\n"
        f"{asi}\n"
        f"Propose {num_children} improved system prompt variants. Return JSON only."
    )

    print(f"  reflecting on {candidate.id} via {REFLECTION_MODEL}...", flush=True)
    print(f"  --- parent prompt ({candidate.id}) ---", flush=True)
    print(_indent(candidate.prompt), flush=True)
    print(f"  --- end parent ---", flush=True)
    raw = call_openrouter_llm(reflection_system, reflection_user, model=REFLECTION_MODEL)
    print(f"  -> got reflection ({len(raw)} chars)", flush=True)

    blocks: list[str] = []
    try:
        cleaned = raw.strip()
        cleaned = re.sub(r'^```\w*\s*\n', '', cleaned)
        cleaned = re.sub(r'\n```\s*$', '', cleaned)
        parsed = _json.loads(cleaned.strip())
        blocks = [p.strip() for p in parsed.get("prompts", []) if isinstance(p, str) and p.strip()]
        print(f"  analysis: {parsed.get('analysis', '')[:120]}", flush=True)
    except Exception:
        blocks = [b.strip() for b in raw.split("---PROMPT---") if b.strip()]

    children: list[Candidate] = []
    for i, block in enumerate(blocks[:num_children]):
        child_id = f"{candidate.id}_child{i+1}"
        print(f"  --- child prompt ({child_id}) ---", flush=True)
        print(_indent(block), flush=True)
        print(f"  --- end child ---", flush=True)
        children.append(Candidate(id=child_id, prompt=block, parent_id=candidate.id, note="LLM reflection-based mutation"))

    if not children:
        new_prompt = (
            candidate.prompt
            + "\nIf you do not output exactly 'ANSWER: <integer>' on the last "
              "line, your answer will be marked wrong."
        )
        children.append(Candidate(id=f"{candidate.id}_fallback", prompt=new_prompt, parent_id=candidate.id, note="fallback heuristic mutation"))
    return children


def pareto_front(candidates: list[Candidate]) -> list[Candidate]:
    """Instance-based Pareto domination (GEPA §3.2).

    Candidate d dominates c iff d scores ≥ c on every individual task instance
    AND strictly > on at least one.  Falls back to aggregate (accuracy, format_rate)
    when instance_scores are unavailable or length-mismatched.
    """
    front: list[Candidate] = []
    for i, c in enumerate(candidates):
        assert c.metrics is not None
        dominated = False
        for j, d in enumerate(candidates):
            if i == j:
                continue
            assert d.metrics is not None
            ci = c.metrics.instance_scores
            di = d.metrics.instance_scores
            if ci and di and len(ci) == len(di):
                # Instance-based: d dominates c if d >= c everywhere AND > somewhere
                if all(ds >= cs for ds, cs in zip(di, ci)) and any(ds > cs for ds, cs in zip(di, ci)):
                    dominated = True
                    break
            else:
                # Aggregate fallback
                if (
                    d.metrics.accuracy >= c.metrics.accuracy
                    and d.metrics.format_rate >= c.metrics.format_rate
                    and (d.metrics.accuracy > c.metrics.accuracy or d.metrics.format_rate > c.metrics.format_rate)
                ):
                    dominated = True
                    break
        if not dominated:
            front.append(c)
    return front


def one_generation(population: list[Candidate],
                   task_traces: dict[str, list[dict]] | None = None) -> list[Candidate]:
    # Parents were already evaluated by the caller — skip redundant re-eval
    print("[phase] reflecting + mutating", flush=True)
    children: list[Candidate] = []
    for c in population:
        traces = task_traces.get(c.id) if task_traces else None
        children.extend(reflect_and_mutate(c, num_children=2, task_traces=traces))
    print(f"[phase] evaluating {len(children)} children", flush=True)
    evaluate_population(children)
    combined = population + children
    front = pareto_front(combined)
    print(f"[phase] pareto front: {len(front)}/{len(combined)} kept", flush=True)
    return front


def plot_all_candidates(all_candidates: dict[str, Candidate],
                        front_ids: set[str]):
    """Single scatter of every candidate we've ever evaluated."""
    candidates = [c for c in all_candidates.values() if c.metrics]
    plt.figure(figsize=(7, 6))
    for c in candidates:
        is_front = c.id in front_ids
        is_seed = c.parent_id is None
        marker = "*" if is_seed else ("o" if is_front else "x")
        size = 220 if is_seed else (160 if is_front else 80)
        color = "tab:orange" if is_seed else (
            "tab:green" if is_front else "tab:gray"
        )
        # tiny jitter so identical points don't overlap
        scatter_kwargs = dict(marker=marker, s=size, c=color, zorder=3)
        if marker != "x":
            scatter_kwargs.update(edgecolors="black", linewidths=0.6)
        plt.scatter(c.metrics.accuracy, c.metrics.format_rate, **scatter_kwargs)
        plt.annotate(
            c.id, (c.metrics.accuracy, c.metrics.format_rate),
            textcoords="offset points", xytext=(8, 6), fontsize=8,
        )
    # Draw parent->child arrows
    for c in candidates:
        if c.parent_id and c.parent_id in all_candidates:
            p = all_candidates[c.parent_id]
            if p.metrics:
                plt.annotate(
                    "", xy=(c.metrics.accuracy, c.metrics.format_rate),
                    xytext=(p.metrics.accuracy, p.metrics.format_rate),
                    arrowprops=dict(arrowstyle="->", color="gray",
                                    alpha=0.5, lw=0.8),
                    zorder=1,
                )
    plt.xlabel("Accuracy")
    plt.ylabel("Format rate")
    plt.title("All evaluated prompts (orange=seed, green=Pareto front, gray=dominated)")
    plt.xlim(-0.05, 1.1)
    plt.ylim(-0.05, 1.1)
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.show()


def plot_prompt_tree(all_candidates: dict[str, Candidate],
                     front_ids: set[str]):
    """Tree view of prompt lineage with metric annotations."""
    children_of: dict[str | None, list[Candidate]] = {}
    for c in all_candidates.values():
        children_of.setdefault(c.parent_id, []).append(c)
    roots = children_of.get(None, [])

    positions: dict[str, tuple[float, float]] = {}

    def layout(node: Candidate, depth: int, x_lo: float, x_hi: float):
        x_mid = (x_lo + x_hi) / 2
        positions[node.id] = (x_mid, -depth)
        kids = children_of.get(node.id, [])
        if not kids:
            return
        slice_w = (x_hi - x_lo) / len(kids)
        for i, k in enumerate(kids):
            layout(k, depth + 1, x_lo + i * slice_w,
                   x_lo + (i + 1) * slice_w)

    for i, root in enumerate(roots):
        layout(root, 0, float(i), float(i + 1))

    fig, ax = plt.subplots(figsize=(12, 7))
    # edges
    for c in all_candidates.values():
        if c.parent_id and c.parent_id in positions and c.id in positions:
            x0, y0 = positions[c.parent_id]
            x1, y1 = positions[c.id]
            ax.plot([x0, x1], [y0, y1], "-", color="gray", alpha=0.6, zorder=1)
    # nodes
    for c in all_candidates.values():
        if c.id not in positions:
            continue
        x, y = positions[c.id]
        is_front = c.id in front_ids
        is_seed = c.parent_id is None
        color = "tab:orange" if is_seed else (
            "tab:green" if is_front else "tab:gray"
        )
        ax.scatter([x], [y], s=380, c=color, edgecolors="black",
                   linewidths=0.8, zorder=2)
        m = c.metrics
        qualities = (
            f"acc={m.accuracy:.2f}  fmt={m.format_rate:.2f}  "
            f"tok={m.avg_tokens:.0f}" if m else "(not evaluated)"
        )
        first_line = c.prompt.strip().splitlines()[0] if c.prompt.strip() else ""
        snippet = (first_line[:60] + "...") if len(first_line) > 60 else first_line
        label = f"{c.id}\n{qualities}\n“{snippet}”"
        ax.annotate(
            label, (x, y),
            textcoords="offset points", xytext=(14, 0),
            fontsize=8, va="center",
            bbox=dict(boxstyle="round,pad=0.3",
                      fc="white", ec="lightgray", alpha=0.9),
        )
    ax.set_axis_off()
    ax.set_title("Prompt evolution tree (orange=seed, green=Pareto front, gray=dominated)")
    # widen x to fit annotations
    if positions:
        xs = [p[0] for p in positions.values()]
        ys = [p[1] for p in positions.values()]
        ax.set_xlim(min(xs) - 0.2, max(xs) + 1.2)
        ax.set_ylim(min(ys) - 0.5, max(ys) + 0.5)
    plt.tight_layout()
    plt.show()


if __name__ == "__main__":
    population = [Candidate(id="seed", prompt=BASE_PROMPT)]
    generations = 1
    all_traces: dict[str, list[dict]] = {}

    for gen in range(generations):
        print(f"\n=== Generation {gen} ===")
        # Collect per-task traces alongside evaluation for ASI
        for c in population:
            all_traces[c.id] = []
            n_pareto   = sum(1 for t in TASKS if t.get("split") == "pareto")
            n_feedback = sum(1 for t in TASKS if t.get("split") == "feedback")
            pareto_correct = 0
            feedback_correct = 0
            well_formatted = 0
            feedback_well_formatted = 0
            val_well_formatted = 0
            total_tokens = 0
            pareto_scores: list[float] = []
            for t in TASKS:
                response = run_model(c.prompt, t["question"])
                is_fmt, is_correct = parse_response(response, t["answer"])
                all_traces[c.id].append({
                    "question": t["question"], "response": response,
                    "expected": t["answer"], "correct": is_correct,
                    "formatted": is_fmt, "split": t.get("split", "feedback"),
                })
                if is_correct:
                    if t.get("split") == "pareto": pareto_correct += 1
                    else: feedback_correct += 1
                if t.get("split") == "pareto":
                    pareto_scores.append(1.0 if is_correct and is_fmt else (0.5 if is_correct else 0.0))
                well_formatted += int(is_fmt)
                if t.get("split") == "feedback":
                    feedback_well_formatted += int(is_fmt)
                else:
                    val_well_formatted += int(is_fmt)
                total_tokens += len(response.split())
            n = len(TASKS)
            c.metrics = EvalResult(
                accuracy=pareto_correct / n_pareto if n_pareto else 0.0,
                feedback_accuracy=feedback_correct / n_feedback if n_feedback else 0.0,
                feedback_format_rate=feedback_well_formatted / n_feedback if n_feedback else 0.0,
                val_format_rate=val_well_formatted / n_pareto if n_pareto else 0.0,
                format_rate=well_formatted / n,
                avg_tokens=total_tokens / n,
                instance_scores=pareto_scores,
            )
            ALL_CANDIDATES[c.id] = c
        for c in population:
            print(c.id, "fb=", round(c.metrics.feedback_accuracy, 2),
                  "val=", round(c.metrics.accuracy, 2),
                  "fmt=", round(c.metrics.format_rate, 2))
        population = one_generation(population, task_traces=all_traces)

    print("\nFinal Pareto front:")
    for c in population:
        print(
            c.id,
            "acc=", round(c.metrics.accuracy, 2),
            "fmt=", round(c.metrics.format_rate, 2),
            f"(parent={c.parent_id})" if c.parent_id else "",
        )
        print(_indent(c.prompt))
        print()

    front_ids = {c.id for c in population}
    plot_all_candidates(ALL_CANDIDATES, front_ids)
    plot_prompt_tree(ALL_CANDIDATES, front_ids)
