import re
import string

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


def check_retrieval_confidence(search_results: list[dict], min_score: float = 5.0) -> bool:
    if not search_results:
        return False
    best_score = max(r.get("rerank_score", 0) for r in search_results)
    return best_score >= min_score