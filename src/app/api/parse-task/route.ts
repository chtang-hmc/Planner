import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are a task parser for a personal productivity app. Parse natural-language task input into structured fields.

Rules:
- "today" = today's date, "tomorrow" = tomorrow's date, "next Monday" etc = compute correctly
- Durations like "30 mins", "1 hour", "2h" → estimated_minutes as integer
- Energy signals: "deep work", "focus", "hard", "think" → high; "quick", "easy", "small" → low; otherwise medium
- project_hint: extract a project name if mentioned (e.g. "for CS class" → "CS", "job app for Google" → "job apps"), otherwise null
- is_calendar_event: true if it sounds like a meeting/appointment/event with a specific time, not a task
- Return ONLY valid JSON, no prose.`

interface ParseRequest {
  text: string
  projects: { id: string; name: string }[]
}

export async function POST(req: NextRequest) {
  const { text, projects } = (await req.json()) as ParseRequest

  if (!text?.trim()) {
    return NextResponse.json({ error: 'No text provided' }, { status: 400 })
  }

  const today = new Date().toISOString().slice(0, 10)
  const projectList = projects.map(p => p.name).join(', ') || 'none'

  const userPrompt = `Today is ${today}.
Available projects: ${projectList}

Parse this task: "${text}"

Respond with JSON matching this exact shape:
{
  "title": "clean concise task title",
  "due_date": "YYYY-MM-DD or null",
  "estimated_minutes": number_or_null,
  "energy_required": "low" | "medium" | "high",
  "project_hint": "project name fragment or null",
  "is_calendar_event": boolean
}`

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : ''

    // Strip markdown code fences if present
    const json = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(json)

    // Fuzzy-match project_hint to an actual project id
    let project_id: string | null = null
    if (parsed.project_hint && projects.length > 0) {
      const hint = parsed.project_hint.toLowerCase()
      const match = projects.find(p => p.name.toLowerCase().includes(hint) || hint.includes(p.name.toLowerCase()))
      if (match) project_id = match.id
    }

    return NextResponse.json({ ...parsed, project_id })
  } catch (err) {
    console.error('parse-task error:', err)
    return NextResponse.json({ error: 'Parse failed' }, { status: 500 })
  }
}
