"""Stateful GEPA session — owns all mutable evolution state."""
from __future__ import annotations
import json
import re
from dataclasses import dataclass, field, asdict
from typing import Callable

from gepa_math_demo import (
    Candidate, EvalResult, TASKS, BASE_PROMPT, REFLECTION_MODEL,
    parse_response, pareto_front,
)
from llm_client import stream_local_llm, stream_openrouter_llm

Emitter = Callable[[str, dict], None]

_N_PARETO   = sum(1 for t in TASKS if t.get("split") == "pareto")
_N_FEEDBACK = sum(1 for t in TASKS if t.get("split") == "feedback")


@dataclass
class GEPASession:
    phase: str = "idle"
    generation: int = 0
    population: list[str] = field(default_factory=list)
    pending_children: list[str] = field(default_factory=list)
    front_ids: list[str] = field(default_factory=list)
    candidates: dict[str, Candidate] = field(default_factory=dict)
    task_results: dict[str, list[dict]] = field(default_factory=dict)
    budget: int = 20
    budget_used: int = 0
    stop_reason: str | None = None

    def start(self) -> None:
        seed = Candidate(id="seed", prompt=BASE_PROMPT)
        self.candidates = {"seed": seed}
        self.population = ["seed"]
        self.pending_children = []
        self.front_ids = []
        self.generation = 0
        self.task_results = {}
        self.budget_used = 0
        self.stop_reason = None
        self.phase = "evaluating_population"

    def to_dict(self) -> dict:
        return {
            "phase": self.phase,
            "generation": self.generation,
            "population": self.population,
            "pending_children": self.pending_children,
            "front_ids": self.front_ids,
            "budget_used": self.budget_used,
            "budget": self.budget,
            "stop_reason": self.stop_reason,
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

    # ── shared eval helper ────────────────────────────────────────────────────

    def _eval_candidate(self, cid: str, emit: Emitter) -> None:
        c = self.candidates[cid]
        emit("eval_start", {"candidate_id": cid})

        # Bug 1 fix: reset before each evaluation so stale results from prior
        # generations don't corrupt instance_scores, ASI traces, or budget counts.
        self.task_results[cid] = []

        pareto_correct = 0
        feedback_correct = 0
        well_formatted = 0
        feedback_well_formatted = 0
        val_well_formatted = 0
        total_tokens = 0

        for i, t in enumerate(TASKS):
            emit("task_start", {
                "candidate_id": cid,
                "task_index": i,
                "question": t["question"],
                "split": t["split"],
            })
            user = f"Problem: {t['question']}\nRemember to follow the required ANSWER format."
            response = ""
            for token in stream_local_llm(c.prompt, user):
                response += token
                emit("task_token", {
                    "candidate_id": cid,
                    "task_index": i,
                    "token": token,
                })
            is_fmt, is_correct = parse_response(response, t["answer"])
            if is_correct:
                if t["split"] == "pareto":
                    pareto_correct += 1
                else:
                    feedback_correct += 1
            well_formatted += int(is_fmt)
            if t["split"] == "feedback":
                feedback_well_formatted += int(is_fmt)
            else:
                val_well_formatted += int(is_fmt)
            total_tokens += len(response.split())
            self.task_results[cid].append({
                "question": t["question"],
                "response": response,
                "expected": t["answer"],
                "correct": is_correct,
                "formatted": is_fmt,
                "split": t["split"],
            })
            emit("task_done", {
                "candidate_id": cid,
                "task_index": i,
                "question": t["question"],
                "response": response,
                "correct": is_correct,
                "formatted": is_fmt,
                "split": t["split"],
            })

        n = len(TASKS)
        # Bug 4 fix: float instance scores (1.0 correct+fmt, 0.5 correct only, 0.0 wrong)
        # so Pareto dominance accounts for format quality on held-out tasks.
        pareto_instance_scores = [
            1.0 if r["correct"] and r["formatted"] else (0.5 if r["correct"] else 0.0)
            for r in self.task_results[cid] if r["split"] == "pareto"
        ]
        c.metrics = EvalResult(
            accuracy=pareto_correct / _N_PARETO if _N_PARETO else 0.0,
            feedback_accuracy=feedback_correct / _N_FEEDBACK if _N_FEEDBACK else 0.0,
            feedback_format_rate=feedback_well_formatted / _N_FEEDBACK if _N_FEEDBACK else 0.0,
            val_format_rate=val_well_formatted / _N_PARETO if _N_PARETO else 0.0,
            format_rate=well_formatted / n,
            avg_tokens=total_tokens / n,
            instance_scores=pareto_instance_scores,
        )
        # Bug 3 fix: only charge budget for new candidate evaluations (children),
        # not for re-evaluating parents that survived selection.
        if cid in self.pending_children:
            self.budget_used += _N_PARETO
        emit("candidate_scored", {
            "candidate_id": cid,
            "metrics": asdict(c.metrics),
        })

    # ── phase steps ───────────────────────────────────────────────────────────

    def step_evaluate_population(self, emit: Emitter) -> None:
        for cid in self.population:
            self._eval_candidate(cid, emit)
        self.phase = "reflecting"

    def step_reflect(self, emit: Emitter) -> None:
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
        new_children: list[str] = []
        for cid in self.population:
            c = self.candidates[cid]
            assert c.metrics is not None

            traces = self.task_results.get(cid, [])
            failed = [r for r in traces if not r["correct"] and r["split"] == "feedback"]
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

            reflection_user = (
                f"Current prompt:\n{c.prompt}\n\n"
                f"Evaluation metrics (D_feedback tasks only — held-out validation tasks are not shown):\n"
                f"- feedback_accuracy: {c.metrics.feedback_accuracy:.2f}  ({int(c.metrics.feedback_accuracy * 100)}% correct on training tasks)\n"
                f"- format_rate:       {c.metrics.feedback_format_rate:.2f}  ({int(c.metrics.feedback_format_rate * 100)}% follow ANSWER: <integer>)\n"
                f"- avg_tokens:        {c.metrics.avg_tokens:.1f}\n"
                f"{asi}\n"
                "Propose 2 improved system prompt variants. Return JSON only."
            )
            emit("reflect_start", {"candidate_id": cid})
            raw = ""
            for token in stream_openrouter_llm(reflection_system, reflection_user, model=REFLECTION_MODEL):
                raw += token
                emit("reflect_token", {"candidate_id": cid, "token": token})

            critique = ""
            blocks: list[str] = []
            try:
                # Bug 2 fix: handle ```json\n{...}\n``` and plain ```\n{...}\n```
                cleaned = raw.strip()
                cleaned = re.sub(r'^```\w*\s*\n', '', cleaned)
                cleaned = re.sub(r'\n```\s*$', '', cleaned)
                parsed = json.loads(cleaned.strip())
                critique = parsed.get("analysis", "").strip()
                blocks = [p.strip() for p in parsed.get("prompts", []) if isinstance(p, str) and p.strip()]
            except Exception:
                critique = raw.split("---PROMPT---")[0].strip() if "---PROMPT---" in raw else ""
                blocks = [b.strip() for b in raw.split("---PROMPT---") if b.strip()]

            if not blocks:
                blocks = [
                    c.prompt + "\nIf you do not output exactly 'ANSWER: <integer>' on the last line, your answer will be marked wrong."
                ]

            children_this_round: list[str] = []
            for i, block in enumerate(blocks[:2]):
                child_id = f"g{self.generation}_{cid}_child{i + 1}"
                child = Candidate(id=child_id, prompt=block, parent_id=cid, note="LLM reflection-based mutation")
                self.candidates[child_id] = child
                new_children.append(child_id)
                children_this_round.append(child_id)
                emit("child_created", {
                    "child": {
                        "id": child_id,
                        "prompt": block,
                        "parent_id": cid,
                        "note": child.note,
                        "metrics": None,
                    }
                })

            emit("reflect_done", {
                "candidate_id": cid,
                "critique": critique,
                "children_ids": children_this_round,
            })

        self.pending_children = new_children
        self.phase = "evaluating_children"

    def step_evaluate_children(self, emit: Emitter) -> None:
        for cid in self.pending_children:
            self._eval_candidate(cid, emit)
        self.phase = "selecting"

    def step_select(self, emit: Emitter) -> None:
        combined_ids = self.population + self.pending_children
        combined = [self.candidates[cid] for cid in combined_ids]
        front = pareto_front(combined)
        prev_front_ids = set(self.front_ids)
        self.population = [c.id for c in front]
        self.front_ids = self.population[:]
        self.pending_children = []
        self.generation += 1

        stop_reason: str | None = None
        if all(self.candidates[cid].metrics.accuracy == 1.0 for cid in self.front_ids):
            stop_reason = "saturated"
        elif set(self.front_ids) == prev_front_ids:
            stop_reason = "converged"
        elif self.budget_used >= self.budget:
            stop_reason = "budget"
        elif self.generation >= 4:
            stop_reason = "max_generations"

        self.stop_reason = stop_reason
        emit("generation_done", {
            "generation": self.generation,
            "front_ids": self.front_ids,
            "budget_used": self.budget_used,
            "budget": self.budget,
            "stop_reason": stop_reason,
        })
        self.phase = "done" if stop_reason else "evaluating_population"
