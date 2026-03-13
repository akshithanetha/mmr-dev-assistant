import json
import re
from fastapi import FastAPI
from pydantic import BaseModel
from app.ollama_client import ask_llm
from app.prompts import (
    feature_prompt,
    refactor_prompt,
    explain_prompt,
    general_prompt,
    find_prompt,
    apply_changes_prompt,
    generate_tests_prompt,
)

app = FastAPI()

class PromptRequest(BaseModel):
    prompt: str
    mode: str = "story"
    workspace_root: str = ""   # ← sent by the VS Code extension


class ChangeRequest(BaseModel):
    story: str
    analysis: str
    workspace_root: str = ""


def parse_json_from_llm(raw: str) -> list:
    """Safely extract a JSON array from LLM output even if wrapped in markdown."""
    # Strip possible markdown fences
    raw = re.sub(r'^```(?:json)?\s*', '', raw.strip())
    raw = re.sub(r'\s*```$', '', raw)
    match = re.search(r'\[.*\]', raw, re.DOTALL)
    if not match:
        return []
    try:
        return json.loads(match.group())
    except json.JSONDecodeError:
        return []


@app.post("/ask")
def ask(request: PromptRequest):
    mode_map = {
        "feature": feature_prompt,
        "refactor": refactor_prompt,
        "explain": explain_prompt,
        "story":   general_prompt,
        "find":    find_prompt,
    }
    prompt_fn = mode_map.get(request.mode, general_prompt)
    result = ask_llm(prompt_fn(request.prompt, request.workspace_root))
    return {"response": result}


@app.post("/apply_changes")
def apply_changes(request: ChangeRequest):
    raw = ask_llm(apply_changes_prompt(
        request.story, request.analysis, request.workspace_root
    ))
    return {"changes": parse_json_from_llm(raw)}


@app.post("/generate_tests")
def generate_tests(request: ChangeRequest):
    raw = ask_llm(generate_tests_prompt(
        request.story, request.analysis, request.workspace_root
    ))
    return {"tests": parse_json_from_llm(raw)}


@app.get("/health")
def health():
    return {"status": "ok"}
