from llm import generate_text
import json
import re

from schemas import EvalResult


def _parse_json_response(text: str) -> dict:
    text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        pass

    fenced = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
    try:
        return json.loads(fenced)
    except Exception:
        pass

    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        return json.loads(match.group(0))

    raise ValueError(f"Could not parse JSON from response: {text[:200]}")


def score_faithfulness(script_text: str, agent_result: str) -> EvalResult:
    prompt = f"""Compare this analysis against the source script. Rate 1-10 how well the
analysis is grounded in the actual script content, versus making unsupported claims.

Script: {script_text}

Analysis: {agent_result}

Respond ONLY with JSON: {{"score": <number>, "reasoning": "<why>"}}"""

    try:
        response = generate_text(
            "You are an evaluation system. Respond only with valid JSON.",
            prompt,
            temperature=0.0,
            response_json=True,
        )
        data = _parse_json_response(response)
        return EvalResult(score=data.get("score"), reasoning=data.get("reasoning", ""))
    except Exception:
        return EvalResult(score=None, reasoning="Could not parse evaluation response.")


def score_context_precision(query: str, retrieved_chunks: list[dict]) -> dict:
    if not retrieved_chunks:
        return {"score": 0, "reasoning": "No chunks retrieved."}

    chunks_text = "\n".join(f"[{i+1}] {c['text']}" for i, c in enumerate(retrieved_chunks))
    prompt = f"""Rate 1-10 how relevant these retrieved chunks are to the query overall.

Query: {query}

Retrieved chunks:
{chunks_text}

Respond ONLY with JSON: {{"score": <number>, "reasoning": "<why>"}}"""

    try:
        response = generate_text(
            "You are an evaluation system. Respond only with valid JSON.",
            prompt,
            temperature=0.0,
            response_json=True,
        )
        return _parse_json_response(response)
    except Exception:
        return {"score": None, "reasoning": "Could not parse evaluation response."}
