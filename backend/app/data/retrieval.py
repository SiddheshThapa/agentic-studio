import json
from app.core.llm import embed_text, generate_text
from app.data.database import search_similar, bm25_search
import numpy as np


def gemini_rerank(query: str, candidates: list[dict]) -> list[dict]:
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
        response = generate_text("You are a relevance scoring system. Respond only with JSON.", prompt)
        scores = json.loads(response).get("scores", [])
        if len(scores) != len(candidates):
            return candidates
        for i, c in enumerate(candidates):
            c["rerank_score"] = float(scores[i])
        candidates.sort(key=lambda x: x["rerank_score"], reverse=True)
        return candidates
    except Exception:
        for c in candidates:
            c["rerank_score"] = c.get("hybrid_score", 0.0)
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