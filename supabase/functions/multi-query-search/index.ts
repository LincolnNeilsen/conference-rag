// Multi-query search over paragraphs, all on the server:
//   1. Rewrite the question into a few phrasings (gpt-4o-mini)
//   2. Embed every phrasing (text-embedding-3-small)
//   3. Search paragraphs for each phrasing, as the signed-in user, so RLS applies
//   4. Merge the results with reciprocal rank fusion
//   5. Answer from the merged paragraphs (gpt-4o)
// Called from the browser with the signed-in user's access token.
// The OpenAI key stays here, on the server, as a Supabase secret.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const MAX_QUESTION_LENGTH = 500
const MAX_PHRASINGS = 3
const MATCHES_PER_PHRASING = 10
const PASSAGES_TO_ANSWER = 5
const RRF_K = 60 // reciprocal rank fusion constant (the usual default)

interface Paragraph {
  id: string
  title: string
  speaker: string
  url: string
  text: string
  similarity: number
}

interface Merged {
  passage: Paragraph
  score: number
  hits: number
  best: number
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function callOpenAI(path: string, body: unknown, apiKey: string) {
  return fetch(`https://api.openai.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

// Step 1: ask a small model for rephrasings. Returns null if the reply is unusable.
async function rewriteQuestion(question: string, apiKey: string): Promise<string[] | null> {
  const res = await callOpenAI('chat/completions', {
    model: 'gpt-4o-mini',
    temperature: 0.7,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You rewrite questions so they can search a collection of General Conference talks. ' +
          `Give ${MAX_PHRASINGS} different phrasings of the question. Use different words, but keep ` +
          'the same meaning. Reply only with JSON: {"variants": ["...", "...", "..."]}',
      },
      { role: 'user', content: question },
    ],
  }, apiKey)
  if (!res.ok) {
    console.error('Rewrite error', res.status, await res.text())
    return null
  }
  const result = await res.json()
  try {
    const variants = JSON.parse(result.choices[0].message.content).variants
    if (!Array.isArray(variants)) return null
    return variants
      .filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0)
      .slice(0, MAX_PHRASINGS)
  } catch {
    return null
  }
}

// Step 2: one embeddings request for all phrasings
async function embedAll(phrasings: string[], apiKey: string): Promise<number[][] | null> {
  const res = await callOpenAI('embeddings', {
    model: 'text-embedding-3-small',
    input: phrasings,
  }, apiKey)
  if (!res.ok) {
    console.error('Embedding error', res.status, await res.text())
    return null
  }
  const result = await res.json()
  return result.data.map((d: { embedding: number[] }) => d.embedding)
}

// Step 5: answer from the merged paragraphs
async function answerFrom(question: string, passages: Paragraph[], apiKey: string): Promise<string | null> {
  const context = passages
    .map((p, i) => `[${i + 1}] "${p.title}" by ${p.speaker}\n${p.text}`)
    .join('\n\n---\n\n')

  const res = await callOpenAI('chat/completions', {
    model: 'gpt-4o',
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content:
          'You answer questions about General Conference talks. Use only the paragraphs provided. ' +
          'Cite the paragraphs you use by their bracketed number and title, like [1] "Title" by Speaker. ' +
          'If the paragraphs do not answer the question, say so.',
      },
      { role: 'user', content: `Paragraphs:\n\n${context}\n\nQuestion: ${question}` },
    ],
  }, apiKey)
  if (!res.ok) {
    console.error('Answer error', res.status, await res.text())
    return null
  }
  const result = await res.json()
  return result.choices[0].message.content
}

Deno.serve(async (req) => {
  // Browser preflight check before the real POST
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Use POST' }, 405)
  }

  // 0. Check the user is signed in. The same client runs the paragraph search,
  //    so the search is subject to RLS as this user.
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ error: 'Sign in first' }, 401)
  }
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return json({ error: 'Sign in first' }, 401)
  }

  // Validate the question
  let body: { question?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }
  const question = typeof body.question === 'string' ? body.question.trim() : ''
  if (!question) {
    return json({ error: 'Missing "question"' }, 400)
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return json({ error: `Question is longer than ${MAX_QUESTION_LENGTH} characters` }, 400)
  }

  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    return json({ error: 'OPENAI_API_KEY secret is not set' }, 500)
  }

  // 1-2. Phrasings, then one embedding for each (the original question goes first)
  const rewrites = await rewriteQuestion(question, apiKey)
  if (!rewrites) {
    return json({ error: 'Could not rewrite the question. Try again.' }, 502)
  }
  const phrasings = [question, ...rewrites]

  const vectors = await embedAll(phrasings, apiKey)
  if (!vectors) {
    return json({ error: 'Embedding service failed. Try again.' }, 502)
  }

  // 3. Search paragraphs for each phrasing
  const searches = await Promise.all(vectors.map((vector) =>
    supabase.rpc('match_paragraphs', {
      query_embedding: vector,
      match_count: MATCHES_PER_PHRASING,
    })
  ))
  const perPhrasing: Paragraph[][] = []
  for (const { data, error } of searches) {
    if (error) {
      return json({ error: `Paragraph search failed: ${error.message}` }, 500)
    }
    perPhrasing.push(data as Paragraph[])
  }

  // 4. Merge: a paragraph scores higher the more phrasings find it, and the higher it ranks
  const merged = new Map<string, Merged>()
  for (const list of perPhrasing) {
    list.forEach((p, rank) => {
      const entry = merged.get(p.id) || { passage: p, score: 0, hits: 0, best: 0 }
      entry.score += 1 / (RRF_K + rank + 1)
      entry.hits += 1
      entry.best = Math.max(entry.best, p.similarity)
      merged.set(p.id, entry)
    })
  }
  const top = [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, PASSAGES_TO_ANSWER)

  // 5. Answer from the merged paragraphs
  const answer = await answerFrom(question, top.map((m) => m.passage), apiKey)
  if (!answer) {
    return json({ error: 'Answer service failed. Try again.' }, 502)
  }

  return json({
    answer,
    phrasings,
    passages: top.map((m) => ({
      title: m.passage.title,
      speaker: m.passage.speaker,
      url: m.passage.url,
      text: m.passage.text,
      similarity: m.best,
      hits: m.hits,
    })),
  })
})
