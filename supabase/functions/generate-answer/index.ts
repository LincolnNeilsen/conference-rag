// Answers a question using the conference talks the browser found.
// Called from the browser with the signed-in user's access token.
// The OpenAI key stays here, on the server, as a Supabase secret.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const MAX_QUESTION_LENGTH = 500
const MAX_TALKS = 5 // keeps the prompt a reasonable size

interface Talk {
  title: string
  speaker: string
  text: string
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isTalk(value: unknown): value is Talk {
  const t = value as Talk
  return typeof t?.title === 'string' && typeof t?.speaker === 'string' && typeof t?.text === 'string'
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

  // 2. Validate the request
  let body: { question?: unknown; context_talks?: unknown }
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
  if (!Array.isArray(body.context_talks) || body.context_talks.length === 0) {
    return json({ error: 'Missing "context_talks"' }, 400)
  }
  if (!body.context_talks.every(isTalk)) {
    return json({ error: 'Each talk needs title, speaker, and text' }, 400)
  }
  const talks = (body.context_talks as Talk[]).slice(0, MAX_TALKS)

  // 3. Build the context and ask GPT-4o
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    return json({ error: 'OPENAI_API_KEY secret is not set' }, 500)
  }

  const context = talks
    .map((t, i) => `[${i + 1}] "${t.title}" by ${t.speaker}\n${t.text}`)
    .join('\n\n---\n\n')

  const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You answer questions about General Conference talks. Use only the talks provided. ' +
            'Cite the talks you use by their bracketed number and title, like [1] "Title" by Speaker. ' +
            'If the talks do not answer the question, say so.',
        },
        {
          role: 'user',
          content: `Talks:\n\n${context}\n\nQuestion: ${question}`,
        },
      ],
    }),
  })
  if (!aiResponse.ok) {
    console.error('OpenAI error', aiResponse.status, await aiResponse.text())
    return json({ error: 'Answer service failed. Try again.' }, 502)
  }
  const result = await aiResponse.json()

  return json({ answer: result.choices[0].message.content })
})
