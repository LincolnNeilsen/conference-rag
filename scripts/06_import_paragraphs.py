"""
Import Paragraph Chunks
=======================
Reads scripts/output/talks.json (which has a "paragraphs" list for each talk),
embeds every paragraph with text-embedding-3-small, and loads the results into
paragraph_embeddings. Replaces any paragraph rows that are already there.

Used by the Compare panel to compare paragraph-level chunks with sentences.

Usage:
    python scripts/06_import_paragraphs.py

Prerequisites:
    - scripts/06_paragraphs_schema.sql has been run
    - config.public.json (Supabase URL) and config.secret.json (OpenAI and service keys)
    - scripts/output/talks.json from scripts/02_scrape_data.py
"""

import json
import os
import sys
import time
import uuid

from openai import OpenAI
from supabase import create_client
from tqdm import tqdm


INPUT_FILE = os.path.join('scripts', 'output', 'talks.json')
OUTPUT_FILE = os.path.join('scripts', 'output', 'paragraphs_with_embeddings.json')
BATCH_SIZE = 100          # embedding requests
INSERT_BATCH_SIZE = 25    # database inserts (each row carries 1,536 numbers)


def main():
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        talks = json.load(f)
    if not talks or 'paragraphs' not in talks[0]:
        print("❌ talks.json has no paragraphs. Re-run scripts/02_scrape_data.py first.")
        sys.exit(1)

    records = []
    for talk in talks:
        # Same talk always gets the same id, so paragraphs group by talk
        talk_id = str(uuid.uuid5(uuid.NAMESPACE_URL, talk['url']))
        for i, paragraph in enumerate(talk['paragraphs'], 1):
            records.append({
                'talk_id': talk_id,
                'title': talk['title'],
                'speaker': talk['speaker'],
                'calling': talk['calling'],
                'year': talk['year'],
                'season': talk['season'],
                'url': talk['url'],
                'paragraph_num': i,
                'text': paragraph,
            })
    print(f"{len(talks)} talks → {len(records):,} paragraphs")

    with open('config.secret.json', 'r', encoding='utf-8') as f:
        secrets = json.load(f)
    with open('config.public.json', 'r', encoding='utf-8') as f:
        public = json.load(f)

    # Embed everything first. If this fails, the database is left untouched.
    openai = OpenAI(api_key=secrets['OPENAI_API_KEY'])
    for i in tqdm(range(0, len(records), BATCH_SIZE), desc="Embedding"):
        batch = records[i:i + BATCH_SIZE]
        response = openai.embeddings.create(
            model='text-embedding-3-small',
            input=[r['text'] for r in batch],
        )
        for record, item in zip(batch, response.data):
            record['embedding'] = item.embedding
        time.sleep(0.1)

    # Save the embeddings to disk, so a failed import doesn't mean paying for them again
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(records, f, ensure_ascii=False)
    print(f"💾 Saved embeddings to {OUTPUT_FILE}")

    client = create_client(public['SUPABASE_URL'], secrets['SUPABASE_SERVICE_KEY'])
    client.table('paragraph_embeddings').delete().neq('id', '00000000-0000-0000-0000-000000000000').execute()

    # Small batches with retries: large inserts were timing out
    for i in tqdm(range(0, len(records), INSERT_BATCH_SIZE), desc="Importing"):
        batch = records[i:i + INSERT_BATCH_SIZE]
        for attempt in range(1, 4):
            try:
                client.table('paragraph_embeddings').insert(batch).execute()
                break
            except Exception as e:
                if attempt == 3:
                    raise
                print(f"\nRetrying batch at {i} after error: {e}")
                time.sleep(5 * attempt)
        time.sleep(0.1)

    result = client.table('paragraph_embeddings').select('id', count='exact').limit(1).execute()
    print(f"\n✅ {result.count or 0:,} paragraphs in paragraph_embeddings")


if __name__ == '__main__':
    main()
