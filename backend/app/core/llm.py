import time
import os
from google import genai
from google.genai import types
from dotenv import load_dotenv
from app.core.config import CHAT_MODEL, EMBEDDING_MODEL

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
_client = genai.Client(api_key=GEMINI_API_KEY)


def embed_text(text: str, max_retries: int = 3) -> list[float]:
    if not text or not text.strip():
        raise ValueError("Cannot embed empty text")

    for attempt in range(max_retries):
        try:
            response = _client.models.embed_content(
                model=EMBEDDING_MODEL,
                contents=text,
                config=types.EmbedContentConfig(output_dimensionality=768),
            )
            return response.embeddings[0].values
        except Exception:
            if attempt == max_retries - 1:
                raise
            time.sleep(2 ** attempt)


def generate_text(
    system_prompt: str,
    user_prompt: str,
    max_retries: int = 3,
    temperature: float = 0.2,
    response_json: bool = False,
) -> str:
    if not user_prompt or not user_prompt.strip():
        raise ValueError("Cannot generate from empty prompt")
    for attempt in range(max_retries):
        try:
            response = _client.models.generate_content(
                model=CHAT_MODEL,
                contents=user_prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=temperature,
                    response_mime_type="application/json" if response_json else None,
                ),
            )
            return response.text
        except Exception as exc:
            if "503" in str(exc) or "UNAVAILABLE" in str(exc):
                if attempt == max_retries - 1:
                    return "I'm having trouble generating a response right now. Please try again."
                time.sleep(2 ** attempt)
                continue
            raise

