import os
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from rank_bm25 import BM25Okapi
from app.core.resilience import with_retry
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import io
import base64

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

@with_retry(max_retries=3, base_delay=1.0)
def get_connection():
    return psycopg2.connect(DATABASE_URL, connect_timeout=5)


def init_tables():
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS documents (
            id SERIAL PRIMARY KEY,
            collection TEXT NOT NULL,
            text TEXT NOT NULL,
            metadata JSONB,
            embedding vector(768)
        );
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS cache (
            question TEXT PRIMARY KEY,
            answer TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        );
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS memory (
            id SERIAL PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        );
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS results (
            id SERIAL PRIMARY KEY,
            task TEXT NOT NULL,
            script_text TEXT NOT NULL,
            result TEXT NOT NULL,
            approved BOOLEAN DEFAULT FALSE,
            feedback TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        );
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS eval_history (
            id SERIAL PRIMARY KEY,
            task TEXT NOT NULL,
            faithfulness_score FLOAT,
            context_precision_score FLOAT,
            created_at TIMESTAMP DEFAULT NOW()
        );
    """)

    cur.execute("ALTER TABLE documents ENABLE ROW LEVEL SECURITY;")
    cur.execute("ALTER TABLE cache ENABLE ROW LEVEL SECURITY;")
    cur.execute("ALTER TABLE memory ENABLE ROW LEVEL SECURITY;")
    cur.execute("ALTER TABLE results ENABLE ROW LEVEL SECURITY;")
    cur.execute("ALTER TABLE eval_history ENABLE ROW LEVEL SECURITY;")

    conn.commit()
    cur.close()
    conn.close()
    print("all tables ready")


def insert_document(collection: str, text: str, metadata: dict, embedding: list[float]) -> int:
    if len(embedding) != 768:
        raise ValueError(f"Embedding must be 768 numbers, got {len(embedding)}")

    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO documents (collection, text, metadata, embedding) VALUES (%s, %s, %s, %s) RETURNING id;",
        (collection, text, psycopg2.extras.Json(metadata), embedding)
    )
    new_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    return new_id


def search_similar(embedding: list[float], collection: str = None, top_k: int = 5) -> list[dict]:
    if len(embedding) != 768:
        raise ValueError(f"Embedding must be 768 numbers, got {len(embedding)}")

    conn = get_connection()
    cur = conn.cursor()

    if collection:
        cur.execute(
            "SELECT id, text, metadata, embedding <=> %s::vector AS distance FROM documents WHERE collection = %s ORDER BY distance LIMIT %s;",
            (embedding, collection, top_k)
        )
    else:
        cur.execute(
            "SELECT id, text, metadata, embedding <=> %s::vector AS distance FROM documents ORDER BY distance LIMIT %s;",
            (embedding, top_k)
        )

    rows = cur.fetchall()
    cur.close()
    conn.close()

    return [{"id": r[0], "text": r[1], "metadata": r[2], "distance": r[3]} for r in rows]


def delete_documents_by_filename(filename: str) -> int:
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "DELETE FROM documents WHERE metadata->>'filename' = %s;",
        (filename,)
    )
    deleted_count = cur.rowcount
    conn.commit()
    cur.close()
    conn.close()
    return deleted_count


def cache_get(question: str, max_age_hours: int = 24) -> str | None:
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT answer FROM cache WHERE question = %s AND created_at > NOW() - INTERVAL '%s hours';",
        (question, max_age_hours)
    )
    row = cur.fetchone()
    cur.close()
    conn.close()
    return row[0] if row else None


def cache_set(question: str, answer: str) -> None:
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO cache (question, answer) VALUES (%s, %s) ON CONFLICT (question) DO UPDATE SET answer = %s;",
        (question, answer, answer)
    )
    conn.commit()
    cur.close()
    conn.close()


def memory_add(session_id: str, role: str, content: str) -> None:
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO memory (session_id, role, content) VALUES (%s, %s, %s);",
        (session_id, role, content)
    )
    conn.commit()
    cur.close()
    conn.close()


def memory_get(session_id: str, limit: int = 20) -> list[dict]:
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT role, content FROM memory WHERE session_id = %s ORDER BY created_at DESC LIMIT %s;",
        (session_id, limit)
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [{"role": r[0], "content": r[1]} for r in reversed(rows)]


def save_result(task: str, script_text: str, result: str) -> int:
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO results (task, script_text, result) VALUES (%s, %s, %s) RETURNING id;",
        (task, script_text, result)
    )
    new_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    return new_id


def get_result(result_id: int) -> dict | None:
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT task, result, approved FROM results WHERE id = %s;", (result_id,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    if not row:
        return None
    return {"task": row[0], "result": row[1], "approved": row[2]}


def get_result_with_script(result_id: int) -> dict | None:
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT task, script_text, result, approved FROM results WHERE id = %s;", (result_id,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    if not row:
        return None
    return {"task": row[0], "script_text": row[1], "result": row[2], "approved": row[3]}




def get_all_documents_for_bm25(collection: str = None) -> list[dict]:
    conn = get_connection()
    cur = conn.cursor()
    if collection:
        cur.execute("SELECT id, text, metadata FROM documents WHERE collection = %s;", (collection,))
    else:
        cur.execute("SELECT id, text, metadata FROM documents;")
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [{"id": r[0], "text": r[1], "metadata": r[2]} for r in rows]



def bm25_search(query: str, collection: str = None, top_k: int = 10) -> list[dict]:
    docs = get_all_documents_for_bm25(collection)
    if not docs:
        return []

    tokenized = [d["text"].lower().split() for d in docs]
    bm25 = BM25Okapi(tokenized)
    scores = bm25.get_scores(query.lower().split())

    scored = sorted(zip(docs, scores), key=lambda x: x[1], reverse=True)
    return [{"id": d["id"], "text": d["text"], "metadata": d["metadata"], "bm25_score": float(s)} for d, s in scored[:top_k]]


def save_eval_record(task: str, faithfulness: float, context_precision: float) -> None:
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO eval_history (task, faithfulness_score, context_precision_score) VALUES (%s, %s, %s);",
        (task, faithfulness, context_precision)
    )
    conn.commit()
    cur.close()
    conn.close()


def get_eval_summary() -> dict:
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT task, faithfulness_score, context_precision_score FROM eval_history;")
    rows = cur.fetchall()
    cur.close()
    conn.close()

    if not rows:
        return {"count": 0}

    faith_scores = [r[1] for r in rows if r[1] is not None]
    precision_scores = [r[2] for r in rows if r[2] is not None]

    return {
        "count": len(rows),
        "average_faithfulness": round(sum(faith_scores) / len(faith_scores), 2) if faith_scores else None,
        "average_context_precision": round(sum(precision_scores) / len(precision_scores), 2) if precision_scores else None,
    }


def generate_eval_chart() -> str:


    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT faithfulness_score, context_precision_score FROM eval_history ORDER BY created_at;")
    rows = cur.fetchall()
    cur.close()
    conn.close()

    if not rows:
        return ""

    faith = [r[0] for r in rows if r[0] is not None]
    precision = [r[1] for r in rows if r[1] is not None]

    fig, ax = plt.subplots(figsize=(8, 4))
    ax.plot(range(1, len(faith) + 1), faith, marker="o", label="Faithfulness")
    ax.plot(range(1, len(precision) + 1), precision, marker="s", label="Context Precision")
    ax.set_xlabel("Run number")
    ax.set_ylabel("Score (0-10)")
    ax.set_title("Evaluation scores over time")
    ax.set_ylim(0, 10)
    ax.legend()

    buf = io.BytesIO()
    fig.savefig(buf, format="png")
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("utf-8")