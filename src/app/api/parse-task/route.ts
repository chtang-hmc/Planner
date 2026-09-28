import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchTimezone, todayStr } from '@/lib/day'
import { PARSE_SCHEMA, PARSE_SYSTEM, buildParsePrompt, normalizeParse } from '@/lib/parse-task'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface ParseRequest {
  text: string
  projects: { id: string; name: string }[]
}

/**
 * ✦ Parse. The prompt, the schema and the checks all live in `lib/parse-task`,
 * derived from one field table; this route only makes the call.
 *
 * The answer is constrained by `output_config.format`, so it is JSON of the
 * right shape or the call fails — there is no code-fence stripping or hopeful
 * `JSON.parse` of free text any more. What comes back is only a proposal: the
 * modal merges it with `fillBlanks`, and the grammar wins wherever it matched.
 */
export async function POST(req: NextRequest) {
  const { text, projects = [] } = (await req.json()) as ParseRequest

  if (!text?.trim()) {
    return NextResponse.json({ error: 'No text provided' }, { status: 400 })
  }

  /**
   * The user's today, not UTC's. From 5pm in Los Angeles the UTC date is
   * already tomorrow, and every relative date would come back a day late.
   */
  const today = todayStr(await fetchTimezone(createServiceClient()))

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: PARSE_SYSTEM,
      messages: [{ role: 'user', content: buildParsePrompt(text, today, projects) }],
      output_config: { format: { type: 'json_schema', schema: PARSE_SCHEMA } },
    })

    // A refusal or a truncated answer need not match the schema.
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
      console.error('parse-task: stopped early:', response.stop_reason)
      return NextResponse.json({ error: 'Parse failed' }, { status: 502 })
    }
    const block = response.content.find(b => b.type === 'text')
    if (!block || block.type !== 'text') {
      return NextResponse.json({ error: 'Parse failed' }, { status: 502 })
    }

    return NextResponse.json(normalizeParse(JSON.parse(block.text), { today, projects }))
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      console.error('parse-task: rate limited')
      return NextResponse.json({ error: 'Busy, try again' }, { status: 429 })
    }
    if (err instanceof Anthropic.APIError) {
      console.error(`parse-task: API error ${err.status}:`, err.message)
    } else {
      console.error('parse-task error:', err)
    }
    return NextResponse.json({ error: 'Parse failed' }, { status: 500 })
  }
}
