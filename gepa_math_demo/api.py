import asyncio
import json
import logging
import time
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse

import os
import requests as _requests
from session import GEPASession
from gepa_math_demo import REFLECTION_MODEL

# ── logging setup ─────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("gepa")

# ── app ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="GEPA Sim API")


@app.on_event("startup")
def log_model_config():
    base_url = os.getenv("LMSTUDIO_BASE_URL", "http://localhost:1234/v1").rstrip("/")
    task_model = os.getenv("LMSTUDIO_MODEL", "mathstral-7b-v0.1")
    try:
        resp = _requests.get(f"{base_url}/models", timeout=3)
        active = [m["id"] for m in resp.json().get("data", [])]
        active_str = ", ".join(active) if active else "(none returned)"
    except Exception:
        active_str = "(LM Studio unreachable)"
    log.info("Task LM  : %s  (requesting from LM Studio: %s)", task_model, base_url)
    log.info("Active in LM Studio: %s", active_str)
    log.info("Reflection LM: %s  (via OpenRouter)", REFLECTION_MODEL)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

session = GEPASession()


@app.middleware("http")
async def log_requests(request: Request, call_next):
    t0 = time.perf_counter()
    response = await call_next(request)
    ms = (time.perf_counter() - t0) * 1000
    log.info("%-6s %-30s  %s  %.0fms",
             request.method, request.url.path,
             response.status_code, ms)
    return response


# ── routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"ok": True}


@app.post("/session/start")
def session_start():
    log.info("SESSION START  (gen=%d candidates=%d)",
             session.generation, len(session.candidates))
    session.start()
    log.info("  → seed created, phase=%s", session.phase)
    return JSONResponse(session.to_dict())


@app.get("/session/state")
def session_state():
    return JSONResponse(session.to_dict())


@app.get("/session/step")
async def session_step():
    queue: asyncio.Queue[dict | None] = asyncio.Queue()
    loop = asyncio.get_event_loop()
    phase = session.phase
    t_start = time.perf_counter()

    log.info("STEP START     phase=%-28s  gen=%d", phase, session.generation)

    def emit(event: str, data: dict) -> None:
        # Log key events inline so the terminal tells the story
        if event == "eval_start":
            log.info("  eval        candidate=%s", data["candidate_id"])
        elif event == "task_start":
            q = data["question"][:60] + ("…" if len(data["question"]) > 60 else "")
            log.info("    task %-2d   %s", data["task_index"] + 1, q)
        elif event == "task_done":
            mark = "✓" if data["correct"] else "✗"
            fmt  = "fmt✓" if data["formatted"] else "fmt✗"
            log.info("    task %-2d   %s correct  %s  → %s",
                     data["task_index"] + 1, mark, fmt,
                     str(data.get("parsed_value", "?"))[:30])
        elif event == "candidate_scored":
            m = data["metrics"]
            log.info("  scored      candidate=%-20s  acc=%.2f fmt=%.2f",
                     data["candidate_id"], m["accuracy"], m["format_rate"])
        elif event == "reflect_start":
            log.info("  reflect     candidate=%s  (calling reflection LM)",
                     data["candidate_id"])
        elif event == "child_created":
            child = data["child"]
            snippet = child["prompt"].splitlines()[0][:50]
            log.info("  child       id=%-22s  prompt: %s…", child["id"], snippet)
        elif event == "generation_done":
            log.info("  generation  #%d  front_ids=%s",
                     data["generation"], data["front_ids"])

        loop.call_soon_threadsafe(queue.put_nowait, {"event": event, "data": data})

    def run_phase() -> None:
        if phase == "evaluating_population":
            session.step_evaluate_population(emit)
        elif phase == "reflecting":
            session.step_reflect(emit)
        elif phase == "evaluating_children":
            session.step_evaluate_children(emit)
        elif phase == "selecting":
            session.step_select(emit)
        loop.call_soon_threadsafe(queue.put_nowait, None)

    loop.run_in_executor(None, run_phase)

    async def generator():
        while True:
            item = await queue.get()
            if item is None:
                elapsed = time.perf_counter() - t_start
                log.info("STEP DONE      phase=%-28s  → %s  (%.1fs)",
                         phase, session.phase, elapsed)
                yield {"event": "phase_done", "data": json.dumps(session.to_dict())}
                return
            yield {"event": item["event"], "data": json.dumps(item["data"])}

    return EventSourceResponse(generator())
