"""
RLS Smoke Test
==============
Uses ONLY the anon key (the same key the frontend ships with) to confirm
Row Level Security behaves as the schema intends:

  1. page_views        -> readable (public SELECT policy)
  2. sentence_embeddings -> zero rows (no policy for anon)
  3. sentence_embeddings -> insert rejected for anon

Usage:
    python tests/test_rls.py

Only reads config.public.json, so it runs in GitHub Actions with no secrets.
"""

import json
import uuid
from pathlib import Path

from supabase import create_client

CONFIG = Path(__file__).resolve().parent.parent / 'config.public.json'
with open(CONFIG) as f:
    public = json.load(f)

client = create_client(public['SUPABASE_URL'], public['SUPABASE_ANON_KEY'])


def test_page_views_readable():
    result = client.table('page_views').select('*').limit(5).execute()
    print(f"page_views: {len(result.data)} rows")
    assert isinstance(result.data, list)


def test_sentence_embeddings_hidden_from_anon():
    result = client.table('sentence_embeddings').select('*').limit(5).execute()
    print(f"sentence_embeddings: {len(result.data)} rows (expected 0)")
    assert len(result.data) == 0, "anon key can read sentence_embeddings: RLS is broken"


def test_sentence_embeddings_insert_rejected_for_anon():
    row = {'talk_id': str(uuid.uuid4()), 'title': 'rls-test', 'text': 'rls-test'}
    try:
        client.table('sentence_embeddings').insert(row).execute()
    except Exception as e:
        print(f"insert rejected as expected: {str(e)[:80]}")
        return
    raise AssertionError("anon key inserted into sentence_embeddings: RLS is broken")


if __name__ == '__main__':
    failures = 0
    for name, test in list(globals().items()):
        if name.startswith('test_') and callable(test):
            try:
                test()
                print(f"PASS {name}")
            except AssertionError as e:
                failures += 1
                print(f"FAIL {name}: {e}")
    if failures:
        raise SystemExit(f"{failures} RLS test(s) failed")
    print("All RLS tests passed")
