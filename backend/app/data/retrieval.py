import json
from app.core.llm import embed_text, generate_text
from app.data.database import search_similar, bm25_search
from app.core.resilience import logger
import numpy as np


def gemini_rerank(query: str, candidates: list[dict]) -> list[dict]:
    """Score each candidate 0-10 for absolute relevance to the query.

    On success every candidate carries a numeric `rerank_score`. If the reranker
    is unavailable or returns something unusable, `rerank_score` is set to None
    rather than being back-filled from `hybrid_score`.

    That back-fill used to be a silent trap: `hybrid_score` is max-normalised to
    0.0-1.0 and is a *ranking* value, not a confidence value, so it could never
    clear the 5.0 confidence threshold in guardrails.py. Every reranker hiccup
    therefore looked exactly like "your knowledge base has nothing relevant".
    None makes the two cases distinguishable — see guardrails.retrieval_status.
    """
    if not candidates:
        return candidates

    candidates_text = "\n".join(f"[{i+1}] {c['text']}" for i, c in enumerate(candidates))
    prompt = f"""Score each document's relevance to the query on a scale of 0-10.
Return ONLY JSON: {{"scores": [7, 2, 9]}}
The array must have exactly {len(candidates)} numbers.

Query: {query}
Documents:
{candidates_text}"""

    try:
        response = generate_text(
            "You are a relevance scoring system. Respond only with JSON.",
            prompt,
            temperature=0.0,
            response_json=True,
        )
        scores = json.loads(response).get("scores", [])
        if len(scores) != len(candidates):
            raise ValueError(
                f"reranker returned {len(scores)} scores for {len(candidates)} documents"
            )
        for i, c in enumerate(candidates):
            c["rerank_score"] = float(scores[i])
        candidates.sort(key=lambda x: x["rerank_score"], reverse=True)
        return candidates
    except Exception as exc:
        logger.warning(f"Reranking unavailable, falling back to hybrid order: {exc}")
        for c in candidates:
            c["rerank_score"] = None
        return candidates


def hybrid_search(query: str, collection: str = None, top_k: int = 3, candidate_n: int = 8) -> list[dict]:
    embedding = embed_text(query)
    dense_results = search_similar(embedding, collection=collection, top_k=candidate_n)
    bm25_results = bm25_search(query, collection=collection, top_k=candidate_n)

    candidates: dict[str, dict] = {}
    for r in dense_results:
        candidates[r["text"]] = {
            "text": r["text"], "metadata": r["metadata"],
            "dense_score": 1 - r["distance"], "bm25_score": 0.0
        }
    for r in bm25_results:
        if r["text"] in candidates:
            candidates[r["text"]]["bm25_score"] = r["bm25_score"]
        else:
            candidates[r["text"]] = {
                "text": r["text"], "metadata": r["metadata"],
                "dense_score": 0.0, "bm25_score": r["bm25_score"]
            }

    candidate_list = list(candidates.values())
    if not candidate_list:
        return []

    dense_scores = np.array([c["dense_score"] for c in candidate_list])
    bm25_scores = np.array([c["bm25_score"] for c in candidate_list])
    dense_norm = dense_scores / (dense_scores.max() + 1e-9)
    bm25_norm = bm25_scores / (bm25_scores.max() + 1e-9)
    combined = 0.6 * dense_norm + 0.4 * bm25_norm

    for i, c in enumerate(candidate_list):
        c["hybrid_score"] = float(combined[i])

    candidate_list.sort(key=lambda x: x["hybrid_score"], reverse=True)
    shortlist = candidate_list[:candidate_n]
    reranked = gemini_rerank(query, shortlist)

    return reranked[:top_k]