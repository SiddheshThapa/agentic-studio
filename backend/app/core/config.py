import os
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
DATABASE_URL = os.getenv("DATABASE_URL")
TMDB_API_KEY = os.getenv("TMDB_API_KEY")
CHAT_MODEL = os.getenv("CHAT_MODEL", "gemini-3.1-flash-lite")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "gemini-embedding-001")

MAX_UPLOAD_FILE_SIZE_MB = 10

AGENT4_BASE_URL = os.getenv("AGENT4_BASE_URL", "http://localhost:8001")
SUPPORTED_COUNTRIES = [
    c.strip().upper()
    for c in os.getenv("SUPPORTED_COUNTRIES", "US,MX,GB,JP,DE").split(",")
    if c.strip()
]

CALENDAR_MODE = os.getenv("CALENDAR_MODE", "service_account")
GOOGLE_SERVICE_ACCOUNT_JSON = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
API_SECRET_KEY = os.getenv("API_SECRET_KEY")

# Signs the login session cookie (see app/core/auth.py). Falls back to
# API_SECRET_KEY so there isn't a second required secret to provision --
# set JWT_SECRET_KEY explicitly if the two should ever rotate independently.
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY") or API_SECRET_KEY