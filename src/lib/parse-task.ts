/**
 * The ✦ Parse contract — what Claude is asked for, how its answer is checked,
 * and how it is merged with what the grammar already found.
 *
 * **One table, three consumers.** `FIELDS` below is the only place a field is
 * named. The JSON schema sent as `output_config.format`, the field list in the
 * prompt and the validator are all derived from it, so the prompt can no longer
 * fall behind the grammar the way it did between 13 and 19 September (#17): a
 * field that exists here is asked for, constrained and read, or it does not
 * exist at all.
 *
 * **The grammar wins wherever it matched.** It is deterministic, it is what the
 * field highlighted, and `p1` is unambiguous in a way no model output is. Claude
 * fills only what the grammar left empty — see `fillBlanks`. That makes the
 * button additive: it can no longer erase a repeat, a time or a priority that
 * was lit up a moment earlier.
 *
 * Pure: no network, no clock. The route supplies `today`.
 */
import type { EnergyLevel } from '@/types'
import type { QuickAddResult } from './quick-add'
import { getFirstOccurrence } from './rrule-utils'

type Nullable = { anyOf: [{ type: string; enum?: string[] }, { type: 'null' }] }
const orNull = (type: string, values?: string[]): Nullable =>
  ({ anyOf: [values ? { type, enum: values } : { type }, { type: 'null' }] })

/**
 * Every field Claude returns. `doc` is what the prompt says about it.
 *
 * Priority is asked for as a word, never a number: the app stores 4 as
 * Critical while `p1` means Critical when typed, and a model given digits
 * would have to guess which scale it was on.
 */
const FIELDS = {
  title: {
    schema: { type: 'string' },
    doc: 'the task itself, with the words that set a date, time, repeat, duration, project or priority removed',
  },
  due_date: {
    schema: orNull('string'),
    doc: '"YYYY-MM-DD" if the text names a day or deadline, resolved against today; otherwise null',
  },
  due_time: {
    schema: orNull('string'),
    doc: '"HH:MM" on a 24-hour clock if the text names a time of day; otherwise null',
  },
  estimated_minutes: {
    schema: orNull('integer'),
    doc: 'minutes the task takes: the duration stated, or your best estimate if none is',
  },
  energy_required: {
    schema: { type: 'string', enum: ['low', 'medium', 'high'] },
    doc: '"high" for deep or hard work (writing, studying, debugging, anything needing focus), "low" for quick or easy things (an email, a call, an errand), otherwise "medium"',
  },
  priority: {
    schema: orNull('string', ['critical', 'high', 'medium', 'low']),
    doc: '"critical" for urgent, asap or drop-everything; "high" for important; "low" for whenever or someday; null if the text does not say',
  },
  rrule: {
    schema: orNull('string'),
    doc: 'an iCal recurrence rule without the "RRULE:" prefix, e.g. "FREQ=WEEKLY;BYDAY=MO" or "FREQ=DAILY;INTERVAL=3", if the task repeats; otherwise null',
  },
  rrule_from_completion: {
    schema: { type: 'boolean' },
    doc: 'true only if the next repeat should count from when the task is finished ("3 days after I last did it") rather than from its due date',
  },
  project_hint: {
    schema: orNull('string'),
    doc: 'the name of one of the available projects if the task belongs to it; otherwise null',
  },
  is_calendar_event: {
    schema: { type: 'boolean' },
    doc: 'true if this is a meeting, appointment or event at a set time rather than a task',
  },
} as const

export type ParseField = keyof typeof FIELDS
export const PARSE_FIELDS = Object.keys(FIELDS) as ParseField[]

/** Sent as `output_config.format.schema`. Every field required; null is how "not stated" is said. */
export const PARSE_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(PARSE_FIELDS.map(k => [k, FIELDS[k].schema])),
  required: PARSE_FIELDS,
  additionalProperties: false,
} as const

export const PARSE_SYSTEM = `You parse one line typed into a personal task planner into structured fields.
Fill a field only from what the text says, except energy_required and estimated_minutes, which are your judgement.
When the text does not state something, use null rather than guessing.`

export function buildParsePrompt(text: string, today: string, projects: { name: string }[]): string {
  const names = projects.map(p => p.name).join(', ') || 'none'
  const fields = PARSE_FIELDS.map(k => `- ${k}: ${FIELDS[k].doc}`).join('\n')
  return `Today is ${today}.
Available projects: ${names}

Fields:
${fields}

Parse this task: ${JSON.stringify(text)}`
}

// ── Checking the answer ──────────────────────────────────────────────────────

/** What the route returns: Claude's answer, checked and put in the app's own terms. */
export interface ParsedTask {
  title: string
  /** Local calendar day, `YYYY-MM-DD`. */
  dueDay: string | null
  /** Minutes past local midnight, 0–1439. */
  timeMinutes: number | null
  estimateMinutes: number | null
  energy: EnergyLevel
  /** The stored scale: 4 is Critical. */
  priority: 1 | 2 | 3 | 4 | null
  /** Bare `FREQ=…`, the form `tasks.rrule` stores. */
  rrule: string | null
  rruleFromCompletion: boolean
  projectId: string | null
  isCalendarEvent: boolean
}

const PRIORITY_FROM_WORD: Record<string, 1 | 2 | 3 | 4> = { critical: 4, high: 3, medium: 2, low: 1 }
const ENERGIES: readonly EnergyLevel[] = ['low', 'medium', 'high']

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function validDay(v: unknown): string | null {
  const s = str(v)
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  // Round-trip through a UTC date so "2026-02-30" is refused rather than rolled over.
  const d = new Date(s + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null
}

function validTime(v: unknown): number | null {
  const m = str(v)?.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  return h <= 23 && min <= 59 ? h * 60 + min : null
}

/**
 * A rule is kept only if it can produce a date. One that parses but never fires
 * would be stored, and fail silently the first time the task is completed.
 */
function validRrule(v: unknown, today: string): string | null {
  const s = str(v)?.replace(/^RRULE:/i, '').toUpperCase()
  if (!s || !/^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)\b/.test(s)) return null
  return getFirstOccurrence(s, today) ? s : null
}

/** Same leniency the route has always had: either name containing the other. */
function matchProject(hint: string | null, projects: { id: string; name: string }[]): string | null {
  if (!hint) return null
  const h = hint.toLowerCase()
  const exact = projects.find(p => p.name.toLowerCase() === h)
  if (exact) return exact.id
  return projects.find(p => p.name.toLowerCase().includes(h) || h.includes(p.name.toLowerCase()))?.id ?? null
}

/**
 * Turn Claude's JSON into a `ParsedTask`, discarding anything malformed.
 *
 * The schema already constrains the shape; this is the second line, for values
 * the schema cannot express — a real calendar day, a clock time, a rule that
 * fires. A bad field becomes null rather than failing the whole parse.
 */
export function normalizeParse(
  raw: unknown,
  opts: { today: string; projects: { id: string; name: string }[] },
): ParsedTask {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const est = o.estimated_minutes
  const rrule = validRrule(o.rrule, opts.today)
  return {
    title: str(o.title) ?? '',
    dueDay: validDay(o.due_date),
    timeMinutes: validTime(o.due_time),
    estimateMinutes: typeof est === 'number' && Number.isInteger(est) && est > 0 && est <= 24 * 60 ? est : null,
    energy: ENERGIES.includes(o.energy_required as EnergyLevel) ? (o.energy_required as EnergyLevel) : 'medium',
    priority: PRIORITY_FROM_WORD[String(o.priority).toLowerCase()] ?? null,
    rrule,
    rruleFromCompletion: !!rrule && o.rrule_from_completion === true,
    projectId: matchProject(str(o.project_hint), opts.projects),
    isCalendarEvent: o.is_calendar_event === true,
  }
}

// ── Merging with the grammar ─────────────────────────────────────────────────

/** Only the fields Claude is allowed to set: each one the grammar left empty. */
export interface ParseFill {
  dueDay?: string
  timeMinutes?: number
  rrule?: string
  rruleFromCompletion?: boolean
  projectId?: string
  priority?: 1 | 2 | 3 | 4
  estimateMinutes?: number
  /** The grammar has no word for energy, so this is always Claude's. */
  energy: EnergyLevel
}

/**
 * The merge rule from #17: the grammar wins wherever it matched; Claude fills
 * only what it left null.
 *
 * The title is never taken from Claude. It is what was typed, minus what was
 * understood — the one promise the field makes — and a model's tidier rewording
 * would break it. A repeat's first day counts as a date the grammar found, so
 * `every monday` is not handed a different due day.
 *
 * One exception, for the one boolean the grammar cannot set false: see the
 * repeat branch.
 */
export function fillBlanks(grammar: QuickAddResult, ai: ParsedTask): ParseFill {
  const fill: ParseFill = { energy: ai.energy }
  if (grammar.dueDay === null && ai.dueDay) fill.dueDay = ai.dueDay
  if (grammar.timeMinutes === null && ai.timeMinutes !== null) fill.timeMinutes = ai.timeMinutes
  if (grammar.rrule === null && ai.rrule) {
    fill.rrule = ai.rrule
    fill.rruleFromCompletion = ai.rruleFromCompletion
  } else if (grammar.rrule !== null && !grammar.recurrenceFromCompletion && ai.rrule && ai.rruleFromCompletion) {
    // The grammar can only say "from completion" (`every!`), never "not from
    // completion", so its false means unstated. "every 3 days after I last did
    // it" is exactly the phrasing it can't read and Claude can.
    fill.rruleFromCompletion = true
  }
  if (grammar.projectId === null && ai.projectId) fill.projectId = ai.projectId
  if (grammar.priority === null && ai.priority !== null) fill.priority = ai.priority
  if (grammar.estimateMinutes === null && ai.estimateMinutes !== null) fill.estimateMinutes = ai.estimateMinutes
  return fill
}
