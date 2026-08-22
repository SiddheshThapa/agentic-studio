"""Checks for the admin table browser's validation layer.

Run directly with no test framework installed:

    python test_admin_tables.py

Also written so `pytest` collects it unchanged, like test_release_conflicts.py.

Scope: everything here is pure — the registry, identifier validation, pagination
clamping and primary-key coercion. Those are the parts that decide what SQL gets
built, so they are the parts worth pinning down. Anything that reads
information_schema or a real row needs a database and is not covered.
"""

from app.data.database import (
    ADMIN_LIST_MAX_LIMIT,
    ADMIN_TABLES,
    AdminTableError,
    _admin_table,
    _clamp_limit,
    _coerce_pk,
    _safe,
    admin_structural_warnings,
    admin_table_names,
)

# ---- the registry ---------------------------------------------------------


def test_every_table_in_the_schema_is_browsable():
    assert admin_table_names() == ["cache", "documents", "eval_history", "memory", "results"]


def test_unknown_table_is_refused_and_says_what_is_known():
    try:
        _admin_table("users")
    except AdminTableError as err:
        assert "users" in str(err) and "results" in str(err)
    else:
        raise AssertionError("an unregistered table must not be reachable")


def test_registry_entries_are_complete():
    for name, spec in ADMIN_TABLES.items():
        assert spec["pk"], f"{name} has no primary key"
        assert spec["pk_type"] in ("int", "text"), f"{name} has an unusable pk type"
        assert spec["order_by"], f"{name} needs a deterministic order for pagination"
        assert spec["note"], f"{name} needs a note explaining what it holds"
        for column, why in spec["structural"].items():
            assert isinstance(column, str) and len(why) > 40, (
                f"{name}.{column} is marked structural but does not explain what depends on it"
            )


# ---- the three invariants the API has to make visible ---------------------


def test_release_date_carrier_is_marked_structural():
    note = ADMIN_TABLES["results"]["structural"]["script_text"]
    assert "|" in note and "check-conflicts" in note


def test_memory_ordering_pair_is_marked_structural():
    structural = ADMIN_TABLES["memory"]["structural"]
    # Both halves, or the ordering can still be broken by editing the other one.
    assert "created_at" in structural and "id" in structural


def test_cache_ttl_source_is_marked_structural():
    note = ADMIN_TABLES["cache"]["structural"]["created_at"]
    assert "24" in note or "TTL" in note


def test_structural_warnings_only_fire_for_structural_columns():
    warned = admin_structural_warnings("results", ["task", "script_text", "result"])
    assert [w["column"] for w in warned] == ["script_text"]
    assert warned[0]["note"]


def test_ordinary_edits_warn_about_nothing():
    assert admin_structural_warnings("eval_history", ["task", "faithfulness_score"]) == []


# ---- documents are grouped, not individual rows ---------------------------


def test_documents_delete_is_grouped_by_filename():
    assert ADMIN_TABLES["documents"]["delete_via"] == "filename"


def test_embeddings_are_not_shipped_in_row_payloads():
    assert "embedding" in ADMIN_TABLES["documents"]["omit"]


# ---- identifier validation: the only place SQL is built from a name -------


def test_a_plain_column_name_is_quoted():
    assert _safe("script_text") == '"script_text"'


def test_identifiers_that_are_not_identifiers_are_refused():
    for attempt in [
        "id; DROP TABLE results",
        'a"b',
        "id --",
        "results.id",
        "",
        "1st_column",
        "id)",
    ]:
        try:
            _safe(attempt)
        except AdminTableError:
            continue
        raise AssertionError(f"{attempt!r} must never reach a statement")


# ---- pagination and row ids ----------------------------------------------


def test_limit_is_clamped_at_both_ends():
    assert _clamp_limit(0) == 1
    assert _clamp_limit(-5) == 1
    assert _clamp_limit(50) == 50
    assert _clamp_limit(10_000) == ADMIN_LIST_MAX_LIMIT


def test_limit_accepts_the_string_a_query_parameter_arrives_as():
    assert _clamp_limit("20") == 20


def test_integer_keyed_tables_coerce_their_row_id():
    assert _coerce_pk(ADMIN_TABLES["results"], "42") == 42


def test_a_non_numeric_id_is_a_bad_request_not_a_query():
    try:
        _coerce_pk(ADMIN_TABLES["results"], "42 OR 1=1")
    except AdminTableError:
        return
    raise AssertionError("a non-numeric id for an int-keyed table must be refused")


def test_text_keyed_tables_keep_their_row_id_as_text():
    digest = "a" * 64
    assert _coerce_pk(ADMIN_TABLES["cache"], digest) == digest


if __name__ == "__main__":
    passed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            passed += 1
            print(f"  ok  {name}")
    print(f"\n{passed} checks passed")
