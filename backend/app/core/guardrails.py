import re
import string
from typing import Literal

from better_profanity import profanity

profanity.load_censor_words()

INJECTION_PATTERNS = [
    "ignore previous instructions",
    "ignore all prior",
    "disregard the above",
    "you are now",
    "system prompt",
    "reveal your instructions",
    "forget everything above",
    "new instructions:",
    "act as if",
    "bypass your rules",
]

DIRECT_ADDRESS_MARKERS = {"you", "your", "you're", "youre", "yourself", "u"}


def check_content_toxicity(text: str) -> bool:
    for sentence in re.split(r"[.!?]", text):
        sentence = sentence.strip().lower()
        if not sentence:
            continue
        tokens = {tok.strip(string.punctuation) for tok in sentence.split()}
        if tokens & DIRECT_ADDRESS_MARKERS and profanity.contains_profanity(sentence):
            return True
    return False


def check_query_safety(text: str, min_length: int = 10, check_toxicity: bool = True) -> bool:
    if not text or len(text.strip()) < min_length:
        return False

    if check_toxicity and check_content_toxicity(text):
        return False

    lowered = " ".join(text.lower().split())
    for pattern in INJECTION_PATTERNS:
        if pattern in lowered:
            return False

    return True


RetrievalStatus = Literal["empty", "unscored", "low_relevance", "confident"]


def retrieval_status(search_results: list[dict], min_score: float = 5.0) -> RetrievalStatus:
    """Why retrieval did or did not produce usable context.

    A single boolean conflated four outcomes, and the caller could not tell an
    empty knowledge base apart from a reranker outage:

    - "empty"         nothing matched the query at all
    - "unscored"      documents were found but the reranker could not score them,
                      so relevance is unknown (not zero)
    - "low_relevance" documents were scored and none cleared `min_score`
    - "confident"     at least one document scored `min_score` or above

    Scores come from gemini_rerank on a 0-10 scale, so `min_score` is on that
    scale too. Callers must not compare it against `hybrid_score`, which is
    max-normalised to 0.0-1.0 and measures rank order, not relevance.
    """
    if not search_results:
        return "empty"

    scores = [
        r["rerank_score"] for r in search_results if r.get("rerank_score") is not None
    ]
    if not scores:
        return "unscored"

    return "confident" if max(scores) >= min_score else "low_relevance"


def check_retrieval_confidence(search_results: list[dict], min_score: float = 5.0) -> bool:
    """True only when retrieval is known-good. Prefer retrieval_status()."""
    return retrieval_status(search_results, min_score) == "confident"