// Turns a question into an embedding vector.
// Called from the browser with the signed-in user's access token.
// The OpenAI key stays here, on the server, as a Supabase secret.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const MAX_QUESTION_LENGTH = 500

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  // Browser preflight check before the real POST
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Use POST' }, 405)
  }

  // 1. Check the user is signed in
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

  // 2. Validate the question
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

  // 3. Ask OpenAI for the embedding
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    return json({ error: 'OPENAI_API_KEY secret is not set' }, 500)
  }
  const aiResponse = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: question }),
  })
  if (!aiResponse.ok) {
    console.error('OpenAI error', aiResponse.status, await aiResponse.text())
    return json({ error: 'Embedding service failed. Try again.' }, 502)
  }
  const result = await aiResponse.json()

  return json({ embedding: result.data[0].embedding })
})
