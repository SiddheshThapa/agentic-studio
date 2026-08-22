"""Checks for login sessions: password hashing and the session JWT / role gate.

Run directly with no test framework installed:

    python test_auth.py

Also written so `pytest` collects it unchanged, like test_admin_tables.py.

Scope: no FastAPI TestClient, no real Postgres. `require_role` re-checks the
session's role against `app.data.database.get_user_by_id` (so a role change
or account deletion doesn't stay live for the rest of a 12h session) — the
require_role tests below monkeypatch that one function with an in-memory
users dict instead of hitting a database.
"""
import os

os.environ.setdefault("API_SECRET_KEY", "test-secret-not-for-prod")

from fastapi import HTTPException

import app.core.auth as auth
from app.core.auth import (
    create_session_token, decode_session_token, get_current_user,
    hash_password, require_role, verify_password,
)

# ---- password hashing -------------------------------------------------------


def test_correct_password_verifies():
    password_hash, salt = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", password_hash, salt)


def test_wrong_password_is_rejected():
    password_hash, salt = hash_password("correct horse battery staple")
    assert not verify_password("wrong password", password_hash, salt)


def test_same_password_hashes_differently_with_different_salts():
    hash_a, salt_a = hash_password("same password")
    hash_b, salt_b = hash_password("same password")
    assert salt_a != salt_b
    assert hash_a != hash_b


# ---- session tokens ----------------------------------------------------------


def test_token_roundtrips_claims():
    token = create_session_token(7, "dev@studio.com", "developer")
    claims = decode_session_token(token)
    assert claims["sub"] == "7"
    assert claims["email"] == "dev@studio.com"
    assert claims["role"] == "developer"


def test_tampered_token_does_not_decode():
    token = create_session_token(7, "dev@studio.com", "developer")
    assert decode_session_token(token + "x") is None


def test_get_current_user_with_no_cookie_is_none():
    assert get_current_user(session=None) is None


# ---- role gate: this is the boundary the client/developer split relies on ----
#
# get_user_by_id is monkeypatched per-test so these stay DB-free; it returns
# (id, email, role) tuples from an in-memory dict standing in for `users`.


def _fake_users(patch_target, users: dict[int, tuple]):
    patch_target.setattr(auth, "get_user_by_id", lambda user_id: users.get(user_id))


class _Patcher:
    """Tiny stand-in for pytest's monkeypatch fixture so this file still runs
    with plain `python test_auth.py` and no test framework installed."""

    def __init__(self):
        self._saved = []

    def setattr(self, obj, name, value):
        self._saved.append((obj, name, getattr(obj, name)))
        setattr(obj, name, value)

    def undo(self):
        for obj, name, value in reversed(self._saved):
            setattr(obj, name, value)


def test_require_role_admits_matching_role():
    patch = _Patcher()
    try:
        _fake_users(patch, {1: (1, "dev@studio.com", "developer")})
        dev_token = create_session_token(1, "dev@studio.com", "developer")
        dev_user = get_current_user(session=dev_token)
        gate = require_role("developer")
        assert gate(user=dev_user)["role"] == "developer"
    finally:
        patch.undo()


def test_require_role_rejects_wrong_role_with_403():
    patch = _Patcher()
    try:
        _fake_users(patch, {2: (2, "client@studio.com", "client")})
        client_token = create_session_token(2, "client@studio.com", "client")
        client_user = get_current_user(session=client_token)
        gate = require_role("developer")
        try:
            gate(user=client_user)
        except HTTPException as err:
            assert err.status_code == 403
        else:
            raise AssertionError("a client-role session must not pass a developer-only gate")
    finally:
        patch.undo()


def test_require_role_rejects_missing_session_with_401():
    gate = require_role("developer")
    try:
        gate(user=None)
    except HTTPException as err:
        assert err.status_code == 401
    else:
        raise AssertionError("no session must not pass any role gate")


def test_require_role_rejects_role_downgraded_since_login():
    """The bug this dependency exists to close: a session minted while the
    user was a developer must lose access the moment the DB row changes,
    without waiting for the JWT to expire."""
    patch = _Patcher()
    try:
        _fake_users(patch, {3: (3, "dev@studio.com", "client")})  # demoted after login
        dev_token = create_session_token(3, "dev@studio.com", "developer")
        dev_user = get_current_user(session=dev_token)
        gate = require_role("developer")
        try:
            gate(user=dev_user)
        except HTTPException as err:
            assert err.status_code == 403
        else:
            raise AssertionError("a role downgraded in the DB must not still pass on the old JWT claim")
    finally:
        patch.undo()


def test_require_role_rejects_deleted_account():
    patch = _Patcher()
    try:
        _fake_users(patch, {})  # user 4 no longer exists
        dev_token = create_session_token(4, "gone@studio.com", "developer")
        dev_user = get_current_user(session=dev_token)
        gate = require_role("developer")
        try:
            gate(user=dev_user)
        except HTTPException as err:
            assert err.status_code == 401
        else:
            raise AssertionError("a deleted account must not still pass on its old JWT")
    finally:
        patch.undo()


if __name__ == "__main__":
    tests = [v for k, v in list(globals().items()) if k.startswith("test_")]
    for test in tests:
        test()
        print(f"ok  {test.__name__}")
    print(f"\n{len(tests)} checks passed")
