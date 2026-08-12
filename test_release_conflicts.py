"""Checks for the two pipelines that stopped depending on an LLM.

Run directly with no test framework installed:

    python test_release_conflicts.py

It is also written so `pytest` collects it unchanged if pytest is added later.
"""

from datetime import date

from agents import (
    COMPETITION_WINDOW_DAYS,
    check_release_conflicts,
    find_competing_releases,
    parse_listing,
)
from guardrails import retrieval_status

# Exactly the shape get_genre_release_listing() produces.
LISTING = """- The Bay (2026-07-02)
- Evil Dead Burn (2026-07-07)
- Colony (2026-05-21)
- Far Future (2027-01-01)
- Untitled Sequel (date unknown)"""


def test_parse_listing_splits_dated_from_undated():
    dated, undated = parse_listing(LISTING)
    assert len(dated) == 4
    assert ("The Bay", date(2026, 7, 2)) in dated
    assert undated == ["Untitled Sequel"]


def test_parse_listing_ignores_non_listing_lines():
    dated, undated = parse_listing("Some heading\n\n- Real Film (2026-01-01)\nnot a row")
    assert dated == [("Real Film", date(2026, 1, 1))]
    assert undated == []


def test_titles_containing_parentheses_survive():
    dated, _ = parse_listing("- Alien (Director's Cut) (2026-03-04)")
    assert dated == [("Alien (Director's Cut)", date(2026, 3, 4))]


def test_finds_only_films_inside_the_window():
    competing, undated = find_competing_releases(date(2026, 7, 4), LISTING)
    titles = [title for title, _, _ in competing]
    assert titles == ["The Bay", "Evil Dead Burn"]  # sorted by release date
    assert "Colony" not in titles  # 44 days earlier
    assert "Far Future" not in titles  # next year
    assert undated == ["Untitled Sequel"]


def test_offsets_are_signed_relative_to_the_proposed_date():
    competing, _ = find_competing_releases(date(2026, 7, 4), LISTING)
    offsets = {title: offset for title, _, offset in competing}
    assert offsets["The Bay"] == -2  # opens 2 days before
    assert offsets["Evil Dead Burn"] == 3  # opens 3 days after


def test_window_boundary_is_inclusive():
    listing = "- Edge (2026-07-18)\n- Just Outside (2026-07-19)"
    competing, _ = find_competing_releases(date(2026, 7, 4), listing)
    assert [t for t, _, _ in competing] == ["Edge"]  # exactly 14 days is a conflict
    assert COMPETITION_WINDOW_DAYS == 14


def test_same_day_release_is_a_conflict():
    competing, _ = find_competing_releases(date(2026, 7, 2), LISTING)
    assert ("The Bay", date(2026, 7, 2), 0) in competing


def test_report_names_every_competing_film():
    report = check_release_conflicts("horror", "2026-07-04", LISTING)
    assert "The Bay" in report and "2026-07-02" in report
    assert "Evil Dead Burn" in report
    assert "2 horror releases" in report
    assert "Untitled Sequel" in report  # undated films are surfaced, not dropped


def test_report_is_explicit_when_nothing_competes():
    report = check_release_conflicts("horror", "2026-10-01", LISTING)
    assert "No horror releases" in report
    assert "The Bay" not in report


def test_empty_listing_does_not_crash():
    assert "No horror releases" in check_release_conflicts("horror", "2026-07-04", "")


# --- the retrieval confidence gate ------------------------------------------
# The bug: a failed reranker used to write hybrid_score (0.0-1.0) into
# rerank_score, which could never reach the 5.0 threshold, so an outage was
# reported to the user as "no relevant guidelines found".


def test_no_results_is_empty():
    assert retrieval_status([]) == "empty"


def test_unscored_results_are_not_mistaken_for_irrelevant():
    unscored = [{"text": "a", "rerank_score": None, "hybrid_score": 1.0}]
    assert retrieval_status(unscored) == "unscored"


def test_genuinely_irrelevant_results_are_low_relevance():
    assert retrieval_status([{"text": "a", "rerank_score": 2.0}]) == "low_relevance"


def test_one_good_score_is_enough():
    results = [{"text": "a", "rerank_score": 1.0}, {"text": "b", "rerank_score": 8.0}]
    assert retrieval_status(results) == "confident"


def test_threshold_is_inclusive():
    assert retrieval_status([{"text": "a", "rerank_score": 5.0}]) == "confident"


if __name__ == "__main__":
    passed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            passed += 1
            print(f"  ok  {name}")
    print(f"\n{passed} checks passed")
