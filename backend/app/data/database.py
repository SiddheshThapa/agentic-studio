import hashlib
import os
import re
import threading
from contextlib import contextmanager
import psycopg2
import psycopg2.extras
import psycopg2.pool
from dotenv import load_dotenv
from rank_bm25 import BM25Okapi
from app.core.resilience import with_retry, logger
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import io
import base64

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

# Opening a connection to a remote Postgres costs roughly 2.4 seconds here, and
# every query used to pay it. A single /run-agent release_check made seven
# connections — about 17 seconds of the response was TCP and TLS setup, not work.
# The pool opens them once and hands the same ones back out.
DB_POOL_MIN = int(os.getenv("DB_POOL_MIN", "1"))
DB_POOL_MAX = int(os.getenv("DB_POOL_MAX", "10"))

_pool: psycopg2.pool.ThreadedConnectionPool | None = None
_pool_lock = threading.Lock()


@with_retry(max_retries=3, base_delay=1.0)
def _create_pool() -> psycopg2.pool.ThreadedConnectionPool:
    return psycopg2.pool.ThreadedConnectionPool(
        DB_POOL_MIN, DB_POOL_MAX, dsn=DATABASE_URL, connect_timeout=5
    )


def get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    """Build the pool on first use rather than at import time.

    Import-time construction would make importing this module fail whenever the
    database is unreachable, which takes the whole API down instead of just the
    endpoints that need data.
    """
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = _create_pool()
                logger.info(f"Database pool ready ({DB_POOL_MIN}-{DB_POOL_MAX} connections)")
    return _pool


@contextmanager
def connection():
    """Borrow a pooled connection; always returned, even on error.

    ponytail: a connection the server closed while idle is discarded and
    retried once. Detecting a *silently* dead connection would need a liveness
    ping per checkout, which costs the round trip the pool exists to avoid. If
    stale connections become a real problem, switch to psycopg_pool, which does
    background health checks.
    """
    pool = get_pool()
    conn = pool.getconn()

    if conn.closed:
        pool.putconn(conn, close=True)
        conn = pool.getconn()

    try:
        yield conn
    except Exception:
        if not conn.closed:
            conn.rollback()
        raise
    finally:
        pool.putconn(conn)


# Every query below goes through one of these four. They exist because the same
# eight lines of open-cursor / execute / fetch / commit / close were repeated in
# fifteen functions, and each copy was a place to forget to return a connection.


def _fetch_all(sql: str, params: tuple = ()) -> list[tuple]:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def _fetch_one(sql: str, params: tuple = ()) -> tuple | None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchone()


def _execute(sql: str, params: tuple = ()) -> int:
    """Run a write and commit. Returns the number of rows affected."""
    with connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        affected = cur.rowcount
        conn.commit()
        return affected


def _execute_returning(sql: str, params: tuple = ()):
    """Run a write with a RETURNING clause and commit. Returns the first column."""
    with connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        value = cur.fetchone()[0]
        conn.commit()
        return value


def init_tables():
    with connection() as conn, conn.cursor() as cur:
        _create_schema(cur)
        conn.commit()
    print("all tables ready")


def _create_schema(cur):
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
            created_at TIMESTAMP DEFAULT NOW()
        );
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS eval_history (
            id SERIAL PRIMARY KEY,
            task TEXT NOT NULL,
            faithfulness_score FLOAT,
            created_at TIMESTAMP DEFAULT NOW()
        );
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('developer', 'client')),
            created_at TIMESTAMP DEFAULT NOW()
        );
    """)

    cur.execute("ALTER TABLE documents ENABLE ROW LEVEL SECURITY;")
    cur.execute("ALTER TABLE cache ENABLE ROW LEVEL SECURITY;")
    cur.execute("ALTER TABLE memory ENABLE ROW LEVEL SECURITY;")
    cur.execute("ALTER TABLE results ENABLE ROW LEVEL SECURITY;")
    cur.execute("ALTER TABLE eval_history ENABLE ROW LEVEL SECURITY;")
    cur.execute("ALTER TABLE users ENABLE ROW LEVEL SECURITY;")


# ---- user accounts ---------------------------------------------------------
# Deliberately not in ADMIN_TABLES: that browser casts every column to text for
# `?q=` search and returns whole rows, which is fine for cache/results but wrong
# for a table holding password_hash/salt. These five functions are the only way
# to touch `users`, and app/core/auth.py is the only caller.


def create_user(email: str, password_hash: str, salt: str, role: str) -> int:
    return _execute_returning(
        "INSERT INTO users (email, password_hash, salt, role) VALUES (%s, %s, %s, %s) RETURNING id;",
        (email.lower(), password_hash, salt, role),
    )


def get_user_by_email(email: str) -> tuple | None:
    return _fetch_one(
        "SELECT id, email, password_hash, salt, role FROM users WHERE email = %s;",
        (email.lower(),),
    )


def list_users() -> list[tuple]:
    return _fetch_all("SELECT id, email, role, created_at FROM users ORDER BY id;")


def get_user_by_id(user_id: int) -> tuple | None:
    """(id, email, role) — used to re-check a session's role against the DB on
    every role-gated request, since the JWT's own `role` claim is a snapshot
    from login time and doesn't see a role change or deletion until it expires."""
    return _fetch_one("SELECT id, email, role FROM users WHERE id = %s;", (user_id,))


def count_developers() -> int:
    return _fetch_one("SELECT COUNT(*) FROM users WHERE role = 'developer';")[0]


def update_user_role(user_id: int, role: str) -> bool:
    return _execute("UPDATE users SET role = %s WHERE id = %s;", (role, user_id)) > 0


def delete_user(user_id: int) -> bool:
    return _execute("DELETE FROM users WHERE id = %s;", (user_id,)) > 0


def insert_document(collection: str, text: str, metadata: dict, embedding: list[float]) -> int:
    if len(embedding) != 768:
        raise ValueError(f"Embedding must be 768 numbers, got {len(embedding)}")

    return _execute_returning(
        "INSERT INTO documents (collection, text, metadata, embedding) VALUES (%s, %s, %s, %s) RETURNING id;",
        (collection, text, psycopg2.extras.Json(metadata), embedding)
    )


def search_similar(embedding: list[float], collection: str = None, top_k: int = 5) -> list[dict]:
    if len(embedding) != 768:
        raise ValueError(f"Embedding must be 768 numbers, got {len(embedding)}")

    if collection:
        rows = _fetch_all(
            "SELECT id, text, metadata, embedding <=> %s::vector AS distance FROM documents WHERE collection = %s ORDER BY distance LIMIT %s;",
            (embedding, collection, top_k)
        )
    else:
        rows = _fetch_all(
            "SELECT id, text, metadata, embedding <=> %s::vector AS distance FROM documents ORDER BY distance LIMIT %s;",
            (embedding, top_k)
        )

    return [{"id": r[0], "text": r[1], "metadata": r[2], "distance": r[3]} for r in rows]


def delete_documents_by_filename(filename: str) -> int:
    return _execute(
        "DELETE FROM documents WHERE metadata->>'filename' = %s;",
        (filename,)
    )


def _cache_key(question: str) -> str:
    # cache.question is a TEXT PRIMARY KEY and script_text can be arbitrarily long;
    # a btree index row caps at 8191 bytes, so store a fixed-length digest instead.
    return hashlib.sha256(question.encode("utf-8")).hexdigest()


def cache_get(question: str, max_age_hours: int = 24) -> str | None:
    row = _fetch_one(
        "SELECT answer FROM cache WHERE question = %s AND created_at > NOW() - INTERVAL '%s hours';",
        (_cache_key(question), max_age_hours)
    )
    return row[0] if row else None


def cache_set(question: str, answer: str) -> None:
    _execute(
        "INSERT INTO cache (question, answer) VALUES (%s, %s) ON CONFLICT (question) DO UPDATE SET answer = %s;",
        (_cache_key(question), answer, answer)
    )


def memory_add(session_id: str, role: str, content: str) -> None:
    _execute(
        "INSERT INTO memory (session_id, role, content) VALUES (%s, %s, %s);",
        (session_id, role, content)
    )


def memory_get(session_id: str, limit: int = 20) -> list[dict]:
    # id breaks ties on created_at. Both turns of a run are now written by one
    # statement, so they share a transaction timestamp to the microsecond and
    # ordering by created_at alone can return the reply before the question.
    rows = _fetch_all(
        "SELECT role, content FROM memory WHERE session_id = %s ORDER BY created_at DESC, id DESC LIMIT %s;",
        (session_id, limit)
    )
    return [{"role": r[0], "content": r[1]} for r in reversed(rows)]


def save_result(task: str, script_text: str, result: str) -> int:
    return _execute_returning(
        "INSERT INTO results (task, script_text, result) VALUES (%s, %s, %s) RETURNING id;",
        (task, script_text, result)
    )


def record_run(
    *,
    task: str,
    script_text: str,
    result: str,
    session_id: str,
    user_turn: str,
    assistant_turn: str,
    cache_question: str | None = None,
) -> int:
    """Persist everything one agent run produces, in a single round trip.

    This used to be four separate calls — memory_add, cache_set, save_result,
    memory_add — and each one paid a full round trip to a remote database. The
    writes go to three different tables, so they can't be one INSERT, but
    Postgres runs data-modifying CTEs exactly once each whether or not the outer
    query reads them, which makes one statement enough.

    Pass cache_question=None on a cache hit, when the answer is already stored.

    Being one statement also makes it one transaction: an answer can no longer
    end up in the cache while its results row failed to save.
    """
    ctes = [
        """saved AS (
            INSERT INTO results (task, script_text, result)
            VALUES (%s, %s, %s)
            RETURNING id
        )""",
        """remembered AS (
            INSERT INTO memory (session_id, role, content)
            VALUES (%s, 'user', %s), (%s, 'assistant', %s)
        )""",
    ]
    params: list = [task, script_text, result, session_id, user_turn, session_id, assistant_turn]

    if cache_question is not None:
        ctes.append(
            """cached AS (
            INSERT INTO cache (question, answer) VALUES (%s, %s)
            ON CONFLICT (question) DO UPDATE SET answer = EXCLUDED.answer
        )"""
        )
        params += [_cache_key(cache_question), result]

    return _execute_returning(
        "WITH " + ",\n".join(ctes) + "\nSELECT id FROM saved;", tuple(params)
    )


def get_result(result_id: int) -> dict | None:
    row = _fetch_one("SELECT task, result FROM results WHERE id = %s;", (result_id,))
    if not row:
        return None
    return {"task": row[0], "result": row[1]}


def get_result_with_script(result_id: int) -> dict | None:
    row = _fetch_one("SELECT task, script_text, result FROM results WHERE id = %s;", (result_id,))
    if not row:
        return None
    return {"task": row[0], "script_text": row[1], "result": row[2]}


def document_exists(collection: str, text: str) -> bool:
    row = _fetch_one(
        "SELECT id FROM documents WHERE collection = %s AND text = %s LIMIT 1;",
        (collection, text)
    )
    return row is not None


def get_all_documents_for_bm25(collection: str = None) -> list[dict]:
    if collection:
        rows = _fetch_all("SELECT id, text, metadata FROM documents WHERE collection = %s;", (collection,))
    else:
        rows = _fetch_all("SELECT id, text, metadata FROM documents;")
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


def save_eval_record(task: str, faithfulness: float) -> None:
    _execute(
        "INSERT INTO eval_history (task, faithfulness_score) VALUES (%s, %s);",
        (task, faithfulness)
    )


def get_eval_summary() -> dict:
    rows = _fetch_all("SELECT faithfulness_score FROM eval_history;")

    if not rows:
        return {"count": 0}

    faith_scores = [r[0] for r in rows if r[0] is not None]

    return {
        "count": len(rows),
        "average_faithfulness": round(sum(faith_scores) / len(faith_scores), 2) if faith_scores else None,
    }


# ---------------------------------------------------------------------------
# Admin table browser
#
# Generic list/read/create/update/delete over the five tables, for an admin UI
# that does not know the schema in advance. Everything here goes through the
# same pool helpers as the rest of this file — there is no second connection
# path, and no cursor is opened outside connection().
#
# Two rules make the generic SQL safe:
#   1. Table names come from ADMIN_TABLES below, never from the request.
#   2. Column names are checked against information_schema for that table, and
#      both must satisfy _SAFE_IDENTIFIER, before they are interpolated.
# Values are always bound parameters. Nothing user-supplied is ever formatted
# into a statement.
# ---------------------------------------------------------------------------

_SAFE_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

ADMIN_LIST_DEFAULT_LIMIT = 50
ADMIN_LIST_MAX_LIMIT = 200

# `structural` marks columns that other code reads for meaning rather than as
# plain data. Editing one is allowed — the note is what the API surfaces so a
# client can warn before it happens.
ADMIN_TABLES: dict[str, dict] = {
    "documents": {
        "pk": "id",
        "pk_type": "int",
        "order_by": "id DESC",
        # Grouped by filename: one uploaded PDF becomes many chunk rows, so a
        # delete has to take the whole group (see admin_delete_row).
        "delete_via": "filename",
        "omit": frozenset({"embedding"}),
        "structural": {
            "embedding": (
                "vector(768) written by ingest.py from the chunk text. Dense search "
                "matches on this; a value that no longer corresponds to the text makes "
                "the chunk unfindable. Omitted from row payloads because of its size."
            ),
            "metadata": (
                "metadata->>'filename' groups every chunk of one uploaded PDF. "
                "DELETE /document and this table's delete both key off it, so clearing "
                "it leaves chunks that can only be removed by id."
            ),
        },
        "note": "One row per chunk, not per document. Prefer POST /ingest over creating rows here — it chunks, classifies and embeds; a row created here has no embedding and will never be returned by dense search.",
    },
    "cache": {
        "pk": "question",
        "pk_type": "text",
        "order_by": "created_at DESC, question DESC",
        "structural": {
            "question": (
                "A sha256 digest of '<task>:<script_text>', not readable question text "
                "(database.py::_cache_key). Editing it orphans the row — no lookup will "
                "ever match it again."
            ),
            "created_at": (
                "The 24-hour TTL is computed from this at read time "
                "(cache_get: created_at > NOW() - INTERVAL). There is no expiry column, "
                "so moving this forward revives an expired answer."
            ),
        },
        "note": "Answers keyed by a hash of their input. Deleting a row only forces the next identical run to call the model again.",
    },
    "memory": {
        "pk": "id",
        "pk_type": "int",
        "order_by": "created_at DESC, id DESC",
        "structural": {
            "created_at": (
                "memory_get orders by created_at DESC, id DESC. Both turns of one run are "
                "written by a single statement and share a transaction timestamp, so "
                "created_at alone cannot separate them."
            ),
            "id": (
                "The tiebreaker for the ordering above. Rewriting ids can sort an "
                "assistant reply before the question it answers."
            ),
        },
        "note": "Conversation turns, two per agent run. Listed newest-first, which is the same ordering memory_get depends on.",
    },
    "results": {
        "pk": "id",
        "pk_type": "int",
        "order_by": "id DESC",
        "structural": {
            "script_text": (
                "For release_check rows this is not script text but '<date>|<listing_result_id>'. "
                "/check-conflicts, /confirm-date, /override-date and /finalize-calendar all "
                "re-split it on '|'. Changing the format breaks all four."
            ),
        },
        "note": "One row per agent run. Its id is the result_id the UI shows and /result/{id} reads.",
    },
    "eval_history": {
        "pk": "id",
        "pk_type": "int",
        "order_by": "id DESC",
        "structural": {},
        "note": "Faithfulness scores. /eval/summary averages faithfulness_score; /eval/chart plots it ordered by created_at.",
    },
}


class AdminTableError(ValueError):
    """Bad table, column, or row id. main.py turns this into a 400/404."""


def admin_table_names() -> list[str]:
    return sorted(ADMIN_TABLES)


def _admin_table(table: str) -> dict:
    spec = ADMIN_TABLES.get(table)
    if spec is None:
        raise AdminTableError(
            f"Unknown table '{table}'. Known tables: {', '.join(admin_table_names())}."
        )
    return spec


def _safe(identifier: str) -> str:
    """Quote an identifier that has already been validated against the schema."""
    if not _SAFE_IDENTIFIER.match(identifier):
        raise AdminTableError(f"Unusable column name '{identifier}'.")
    return f'"{identifier}"'


def _clamp_limit(limit: int) -> int:
    return max(1, min(int(limit), ADMIN_LIST_MAX_LIMIT))


def _coerce_pk(spec: dict, row_id):
    """Path parameters arrive as strings; the int-keyed tables need real ints."""
    if spec["pk_type"] != "int":
        return str(row_id)
    try:
        return int(row_id)
    except (TypeError, ValueError):
        raise AdminTableError(f"Row id must be a whole number, got '{row_id}'.")


def admin_columns(table: str) -> list[dict]:
    """Live column metadata, so a client can render the table without the schema.

    Read from information_schema rather than hardcoded, because the schema is
    created with CREATE TABLE IF NOT EXISTS and has been hand-altered before —
    a hardcoded list would drift silently.
    """
    spec = _admin_table(table)
    rows = _fetch_all(
        """
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        ORDER BY ordinal_position;
        """,
        (table,),
    )
    structural = spec["structural"]
    omitted = spec.get("omit", frozenset())

    return [
        {
            "name": name,
            "type": data_type,
            "nullable": is_nullable == "YES",
            "default": default,
            "primary_key": name == spec["pk"],
            "structural": name in structural,
            "structural_note": structural.get(name),
            "omitted": name in omitted,
        }
        for name, data_type, is_nullable, default in rows
    ]


def _readable_columns(table: str) -> list[str]:
    spec = _admin_table(table)
    omitted = spec.get("omit", frozenset())
    return [c["name"] for c in admin_columns(table) if c["name"] not in omitted]


def _row_to_dict(columns: list[str], row: tuple) -> dict:
    return dict(zip(columns, row))


def admin_table_summary() -> list[dict]:
    """Every table with its row count, for the browser's index."""
    summary = []
    for name in admin_table_names():
        spec = ADMIN_TABLES[name]
        # Safe: `name` is a literal key of ADMIN_TABLES, never request input.
        total = _fetch_one(f"SELECT COUNT(*) FROM {_safe(name)};")[0]
        summary.append(
            {
                "name": name,
                "primary_key": spec["pk"],
                "rows": total,
                "structural_columns": sorted(spec["structural"]),
                "note": spec["note"],
            }
        )
    return summary


def _search_clause(columns: list[str], query: str | None) -> tuple[str, list]:
    """Case-insensitive substring match across every readable column.

    Each column is cast to text so one clause covers ids, timestamps and JSONB
    alike — searching "2026-11" finds a created_at, "thriller" finds a task.

    ponytail: this is a sequential scan with an ILIKE per column, which is fine
    for a table you can browse by hand and wrong for one you cannot. If it ever
    matters, add a pg_trgm index per searched column, or a tsvector column
    maintained by a trigger, and match against that instead.
    """
    if not query or not query.strip():
        return "", []
    clauses = " OR ".join(f"({_safe(c)})::text ILIKE %s" for c in columns)
    return f" WHERE ({clauses})", [f"%{query.strip()}%"] * len(columns)


def admin_list_rows(
    table: str,
    limit: int = ADMIN_LIST_DEFAULT_LIMIT,
    offset: int = 0,
    query: str | None = None,
) -> dict:
    spec = _admin_table(table)
    limit = _clamp_limit(limit)
    offset = max(0, int(offset))

    columns = _readable_columns(table)
    selected = ", ".join(_safe(c) for c in columns)
    where, where_params = _search_clause(columns, query)

    # The count uses the same filter, or pagination would page through a total
    # that does not match the rows being shown.
    total = _fetch_one(f"SELECT COUNT(*) FROM {_safe(table)}{where};", tuple(where_params))[0]
    rows = _fetch_all(
        f"SELECT {selected} FROM {_safe(table)}{where} ORDER BY {spec['order_by']} LIMIT %s OFFSET %s;",
        tuple(where_params) + (limit, offset),
    )

    return {
        "table": table,
        "primary_key": spec["pk"],
        "ordered_by": spec["order_by"],
        "note": spec["note"],
        "search": query.strip() if query and query.strip() else None,
        "columns": admin_columns(table),
        "pagination": {
            "limit": limit,
            "offset": offset,
            "total": total,
            "returned": len(rows),
            "has_more": offset + len(rows) < total,
        },
        "rows": [_row_to_dict(columns, r) for r in rows],
    }


def admin_get_row(table: str, row_id) -> dict | None:
    spec = _admin_table(table)
    columns = _readable_columns(table)
    selected = ", ".join(_safe(c) for c in columns)

    row = _fetch_one(
        f"SELECT {selected} FROM {_safe(table)} WHERE {_safe(spec['pk'])} = %s;",
        (_coerce_pk(spec, row_id),),
    )
    return _row_to_dict(columns, row) if row else None


def _validate_writable(table: str, values: dict) -> list[str]:
    """Reject unknown columns before building a statement. Returns the column order."""
    if not isinstance(values, dict) or not values:
        raise AdminTableError("Provide at least one column to write, as a JSON object.")

    known = {c["name"] for c in admin_columns(table)}
    unknown = [c for c in values if c not in known]
    if unknown:
        raise AdminTableError(
            f"Unknown column(s) for '{table}': {', '.join(sorted(unknown))}. "
            f"Known columns: {', '.join(sorted(known))}."
        )
    return list(values)


def admin_structural_warnings(table: str, columns: list[str]) -> list[dict]:
    """The visible-risk part of the contract: name every structural column touched."""
    structural = _admin_table(table)["structural"]
    return [
        {"column": c, "note": structural[c]} for c in columns if c in structural
    ]


def admin_insert_row(table: str, values: dict) -> dict:
    spec = _admin_table(table)
    columns = _validate_writable(table, values)

    placeholders = ", ".join(["%s"] * len(columns))
    names = ", ".join(_safe(c) for c in columns)
    new_id = _execute_returning(
        f"INSERT INTO {_safe(table)} ({names}) VALUES ({placeholders}) RETURNING {_safe(spec['pk'])};",
        tuple(values[c] for c in columns),
    )
    return {"row_id": new_id, "row": admin_get_row(table, new_id)}


def admin_update_row(table: str, row_id, values: dict) -> dict | None:
    spec = _admin_table(table)
    columns = _validate_writable(table, values)

    assignments = ", ".join(f"{_safe(c)} = %s" for c in columns)
    params = tuple(values[c] for c in columns) + (_coerce_pk(spec, row_id),)

    affected = _execute(
        f"UPDATE {_safe(table)} SET {assignments} WHERE {_safe(spec['pk'])} = %s;",
        params,
    )
    if affected == 0:
        return None

    # The primary key may itself have been rewritten, so read back by the new value.
    lookup = values.get(spec["pk"], row_id)
    return {"updated": columns, "row": admin_get_row(table, lookup)}


def admin_delete_row(table: str, row_id) -> dict:
    """Delete one row — except in documents, where chunks are deleted as a group.

    A documents row is one chunk of an uploaded PDF. Removing a single chunk
    leaves a half-searchable document, so this routes to the same
    delete_documents_by_filename path DELETE /document uses.
    """
    spec = _admin_table(table)
    pk_value = _coerce_pk(spec, row_id)

    if spec.get("delete_via") == "filename":
        row = _fetch_one(
            "SELECT metadata->>'filename' FROM documents WHERE id = %s;", (pk_value,)
        )
        if row is None:
            return {"deleted_rows": 0, "grouped_by": None, "filename": None}
        filename = row[0]
        if not filename:
            raise AdminTableError(
                f"documents row {pk_value} has no metadata.filename, so its chunk group "
                "cannot be identified. Chunks are deleted by filename, never individually."
            )
        return {
            "deleted_rows": delete_documents_by_filename(filename),
            "grouped_by": "filename",
            "filename": filename,
        }

    affected = _execute(
        f"DELETE FROM {_safe(table)} WHERE {_safe(spec['pk'])} = %s;", (pk_value,)
    )
    return {"deleted_rows": affected, "grouped_by": None}


def generate_eval_chart() -> str:
    rows = _fetch_all("SELECT faithfulness_score FROM eval_history ORDER BY created_at;")

    if not rows:
        return ""

    faith = [r[0] for r in rows if r[0] is not None]

    fig, ax = plt.subplots(figsize=(8, 4))
    ax.plot(range(1, len(faith) + 1), faith, marker="o", label="Faithfulness")
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