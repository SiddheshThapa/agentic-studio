import time
import logging
import functools

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("agentic_studio")


def with_retry(max_retries: int = 3, base_delay: float = 1.0):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last_error = None
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except Exception as exc:
                    last_error = exc
                    logger.warning(f"{func.__name__} failed (attempt {attempt+1}/{max_retries}): {exc}")
                    if attempt < max_retries - 1:
                        time.sleep(base_delay * (2 ** attempt))
            logger.error(f"{func.__name__} failed after {max_retries} attempts")
            raise last_error
        return wrapper
    return decorator


_rate_limit_tracker: dict[str, list[float]] = {}


def check_rate_limit(session_id: str, max_requests: int = 10, window_seconds: int = 60) -> bool:
    now = time.time()
    history = _rate_limit_tracker.get(session_id, [])
    history = [t for t in history if now - t < window_seconds]

    if len(history) >= max_requests:
        logger.warning(f"Rate limit exceeded for session {session_id}")
        return False

    history.append(now)
    _rate_limit_tracker[session_id] = history
    return True


def safe_generate(generate_func, *args, fallback_message: str = "Service temporarily unavailable. Please try again shortly.", **kwargs):
    try:
        return generate_func(*args, **kwargs)
    except Exception as exc:
        logger.error(f"Generation failed, using fallback: {exc}")
        return fallback_message