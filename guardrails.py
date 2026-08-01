INJECTION_PATTERNS = [
    "ignore previous instructions",
    "ignore all prior",
    "disregard the above",
    "you are now",
    "system prompt",
    "reveal your instructions",
]


def check_query_safety(text: str, min_length: int = 10) -> bool:
    if not text or len(text.strip()) < min_length:
        return False

    lowered = text.lower()
    for pattern in INJECTION_PATTERNS:
        if pattern in lowered:
            return False

    return True


def check_retrieval_confidence(search_results: list[dict], min_score: float = 5.0) -> bool:
    if not search_results:
        return False
    best_score = max(r.get("rerank_score", 0) for r in search_results)
    return best_score >= min_score