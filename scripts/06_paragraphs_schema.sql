-- Paragraph-level chunks for the Compare panel.
-- Kept in its own table so the sentence data (sentence_embeddings) stays untouched.
-- Run once in the Supabase SQL Editor, or with psql (see steps/ or the README).

create table if not exists paragraph_embeddings (
    id uuid primary key default gen_random_uuid(),
    talk_id uuid not null,
    title text not null,
    speaker text,
    calling text,
    year integer,
    season text,
    url text,
    paragraph_num integer,
    text text not null,
    embedding vector(1536)
);

create index if not exists paragraph_embeddings_talk_id_idx
    on paragraph_embeddings(talk_id);

-- Same access rule as sentence_embeddings: logged-in users can read, nobody else can.
alter table paragraph_embeddings enable row level security;

drop policy if exists "Allow authenticated users to read" on paragraph_embeddings;
create policy "Allow authenticated users to read"
on paragraph_embeddings for select
to authenticated
using (true);

-- Similarity search over paragraphs, same shape as match_sentences().
create or replace function match_paragraphs(
    query_embedding vector(1536),
    match_count int default 5
)
returns table (
    id uuid,
    talk_id uuid,
    title text,
    speaker text,
    paragraph_num int,
    text text,
    url text,
    similarity float
)
language sql stable
as $$
    select
        paragraph_embeddings.id,
        paragraph_embeddings.talk_id,
        paragraph_embeddings.title,
        paragraph_embeddings.speaker,
        paragraph_embeddings.paragraph_num,
        paragraph_embeddings.text,
        paragraph_embeddings.url,
        1 - (paragraph_embeddings.embedding <=> query_embedding) as similarity
    from paragraph_embeddings
    order by paragraph_embeddings.embedding <=> query_embedding
    limit match_count;
$$;

-- Index for fast cosine search (the same kind the sentence table uses).
create index if not exists paragraph_embeddings_embedding_hnsw_idx
    on paragraph_embeddings using hnsw (embedding vector_cosine_ops);
