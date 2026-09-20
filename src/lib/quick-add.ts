/**
 * Quick-add — Todoist-style natural language in the add-task field.
 *
 * One text field. The parser finds date and time tokens anywhere in the string,
 * hands back their source offsets so the input can highlight them live, and
 * returns the title with those spans removed. "Email Rosner tomorrow at 5pm"
 * becomes the title "Email Rosner" plus a due day and a time.
 *
 * **Pure by construction.** `now` and `tz` are injected; nothing here reads the
 * clock, the database or the DOM. That is what makes the grammar testable, and
 * the grammar is the part that has to be right.
 *
 * **Days are local days.** "tomorrow" is a calendar-day concept, so every
 * resolution runs on day strings (`YYYY-MM-DD`) through `lib/day`, never on
 * `Date` arithmetic. A parser that does `new Date(Date.now() + 86400000)` files
 * a 7pm task a day late west of UTC — the same bug this codebase has already
 * fixed three times in other places.
 *
 * **`dueISO` is UTC midnight of the local day**, which is the `due_date`
 * convention the whole app relies on: every comparison does
 * `due_date.slice(0, 10)`, so storing a real instant there would read as the
 * wrong day. The parsed *time* is returned separately rather than folded into
 * that timestamp, precisely so it can't corrupt the day.
 *
 * Dates, times and recurrence are covered. The metadata tokens (`#project`,
 * `p1`) are separate token types, already reserved in `TokenType`, so adding
 * them does not change this contract.
 */
import { addDays, dayOfWeek, localDayStr } from './day'
import { weekStartOfDay, WEEK_START_DEFAULT, WeekStartDay } from './week'
import { getFirstOccurrence } from './rrule-utils'

export type TokenType =
  | 'date' | 'time'
  // Reserved for later stages — listed here so consumers can switch
  // exhaustively now and not break when they start being produced.
  | 'recurrence' | 'project' | 'priority' | 'duration' | 'label'

export interface QuickAddToken {
  /** Offsets into the *original* text, so the input can highlight in place. */
  start: number
  end: number
  type: TokenType
  /** The source text that matched. */
  text: string
  /** How to render it to the user, e.g. "Tomorrow" or "5:00 PM". */
  label: string
}

export interface QuickAddResult {
  /** The text with every recognised token removed and whitespace tidied. */
  title: string
  /** In source order. */
  tokens: QuickAddToken[]
  /** Local calendar day, `YYYY-MM-DD`, or null if no date was found. */
  dueDay: string | null
  /** UTC midnight of `dueDay` — what goes in `tasks.due_date`. */
  dueISO: string | null
  /** Minutes from local midnight, or null for an all-day task. */
  timeMinutes: number | null
  /** Bare `FREQ=…` string for `tasks.rrule`, or null if the task doesn't repeat. */
  rrule: string | null
  /**
   * `every!` — the next occurrence counts from completion rather than from the
   * due date. Returned separately from `rrule` because iCal has no way to say
   * it: it is a property of how *this app* advances a chain, not of the rule.
   */
  recurrenceFromCompletion: boolean
  /**
   * A project *name* as typed after `#`, matched against the list passed in
   * `opts.projects`. Null when nothing matched — the token then stays in the
   * title rather than becoming a project that does not exist.
   */
  projectId: string | null
  /**
   * The stored priority, 1–4, where 4 is Critical.
   *
   * Note this is **not** the number typed: `p1` is Todoist's most urgent and
   * resolves to 4 here. See `PRIORITY_FROM_TOKEN`.
   */
  priority: 1 | 2 | 3 | 4 | null
  /** `for 45m`, `for 2h` — minutes. */
  estimateMinutes: number | null
}

export interface QuickAddOptions {
  /** IANA zone the user's days are counted in. */
  tz: string
  /** Defaults to the real clock. Injected in tests. */
  now?: Date
  /** Which of `3/4` is the month. Defaults to month-first. */
  dateOrder?: 'MDY' | 'DMY'
  /** Used only by `next <weekday>` and `next week`. */
  weekStart?: WeekStartDay
  /**
   * Projects `#name` can match. Omitted, `#foo` is left in the title — the
   * grammar never invents a project, because a typo would otherwise create one
   * silently and there is no undo for that in the add flow.
   */
  projects?: { id: string; name: string }[]
}

// ── Vocabulary ───────────────────────────────────────────────────────────────
// Longest spelling first in each group: the alternation is tried in order, so
// `thu` listed before `thursday` would match the stem and leave "rsday" behind.

const WEEKDAYS: [string, number][] = [
  ['sunday', 0], ['sun', 0],
  ['monday', 1], ['mon', 1],
  ['tuesday', 2], ['tues', 2], ['tue', 2],
  ['wednesday', 3], ['weds', 3], ['wed', 3],
  ['thursday', 4], ['thurs', 4], ['thur', 4], ['thu', 4],
  ['friday', 5], ['fri', 5],
  ['saturday', 6], ['sat', 6],
]

const MONTHS: [string, number][] = [
  ['january', 1], ['jan', 1],
  ['february', 2], ['feb', 2],
  ['march', 3], ['mar', 3],
  ['april', 4], ['apr', 4],
  ['may', 5],
  ['june', 6], ['jun', 6],
  ['july', 7], ['jul', 7],
  ['august', 8], ['aug', 8],
  ['september', 9], ['sept', 9], ['sep', 9],
  ['october', 10], ['oct', 10],
  ['november', 11], ['nov', 11],
  ['december', 12], ['dec', 12],
]

const WEEKDAY_RE = WEEKDAYS.map(([w]) => w).join('|')
const MONTH_RE   = MONTHS.map(([m]) => m).join('|')

const WEEKDAY_NUM = new Map(WEEKDAYS)
const MONTH_NUM   = new Map(MONTHS)

/**
 * Words that may sit in front of a date and belong to it rather than to the
 * title. Folded into each pattern so they're stripped with the date — "Pay rent
 * by friday" should not leave "Pay rent by".
 */
const LEAD = String.raw`(?:\b(?:due\s+)?(?:by|on|before|starting|starts|start|from)\s+|\bdue\s+)?`

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

function daysInMonth(y: number, m1: number): number {
  return m1 === 2 && isLeap(y) ? 29 : MONTH_LENGTHS[m1 - 1]
}

/** Build a day string, clamping the day into the month (Jan 31 + 1 month → Feb 28). */
function makeDay(y: number, m1: number, d: number): string {
  const day = Math.min(d, daysInMonth(y, m1))
  return `${y}-${String(m1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function partsOf(dayStr: string): { y: number; m: number; d: number } {
  return {
    y: Number(dayStr.slice(0, 4)),
    m: Number(dayStr.slice(5, 7)),
    d: Number(dayStr.slice(8, 10)),
  }
}

/** `n` months on, keeping the day of month where the target month is long enough. */
function addMonths(dayStr: string, n: number): string {
  const { y, m, d } = partsOf(dayStr)
  const total = (y * 12 + (m - 1)) + n
  return makeDay(Math.floor(total / 12), (total % 12) + 1, d)
}

function endOfMonth(dayStr: string): string {
  const { y, m } = partsOf(dayStr)
  return makeDay(y, m, daysInMonth(y, m))
}

/** The next `target` weekday on or after `from`. */
function nextWeekday(from: string, target: number): string {
  const delta = (target - dayOfWeek(from) + 7) % 7
  return addDays(from, delta)
}

/**
 * `next <weekday>` — that weekday in the *following* week, not merely the next
 * one to come round.
 *
 * On a Wednesday, plain "monday" is five days away and "next monday" is twelve;
 * without the distinction the two would mean the same thing and one of them
 * would be a lie. Anchored on the user's configured first day of the week, so
 * it agrees with everything else that talks about weeks.
 */
function weekdayNextWeek(today: string, target: number, weekStart: WeekStartDay): string {
  const nextWeekStart = addDays(weekStartOfDay(today, weekStart), 7)
  return nextWeekday(nextWeekStart, target)
}

// ── Date grammar ─────────────────────────────────────────────────────────────

interface Ctx {
  today: string
  dateOrder: 'MDY' | 'DMY'
  weekStart: WeekStartDay
}

interface Rule {
  re: RegExp
  resolve: (m: RegExpMatchArray, ctx: Ctx) => string | null
}

/**
 * Tried in order, first match by position wins. Specific patterns come before
 * general ones so `next monday` is not eaten by the bare-weekday rule.
 */
const DATE_RULES: Rule[] = [
  { re: new RegExp(LEAD + String.raw`\b(?:the\s+)?day after tomorrow\b`, 'i'),
    resolve: (_m, c) => addDays(c.today, 2) },

  { re: new RegExp(LEAD + String.raw`\b(?:today|tod)\b`, 'i'),
    resolve: (_m, c) => c.today },

  { re: new RegExp(LEAD + String.raw`\b(?:tomorrow|tomo|tmrw|tmr|tom)\b`, 'i'),
    resolve: (_m, c) => addDays(c.today, 1) },

  { re: new RegExp(LEAD + String.raw`\byesterday\b`, 'i'),
    resolve: (_m, c) => addDays(c.today, -1) },

  // "end of month" / "eom" — the last day, not the first of the next.
  { re: new RegExp(LEAD + String.raw`\b(?:end of (?:the )?month|eom)\b`, 'i'),
    resolve: (_m, c) => endOfMonth(c.today) },

  { re: new RegExp(LEAD + String.raw`\b(?:end of (?:the )?week|eow)\b`, 'i'),
    resolve: (_m, c) => addDays(weekStartOfDay(c.today, c.weekStart), 6) },

  { re: new RegExp(LEAD + String.raw`\bnext\s+(${WEEKDAY_RE})\b`, 'i'),
    resolve: (m, c) => weekdayNextWeek(c.today, WEEKDAY_NUM.get(m[1].toLowerCase())!, c.weekStart) },

  // "this friday" / "coming friday" — the one in hand, same as bare.
  { re: new RegExp(LEAD + String.raw`\b(?:this|coming)\s+(${WEEKDAY_RE})\b`, 'i'),
    resolve: (m, c) => nextWeekday(c.today, WEEKDAY_NUM.get(m[1].toLowerCase())!) },

  { re: new RegExp(LEAD + String.raw`\bnext\s+week\b`, 'i'),
    resolve: (_m, c) => addDays(weekStartOfDay(c.today, c.weekStart), 7) },

  { re: new RegExp(LEAD + String.raw`\bnext\s+month\b`, 'i'),
    resolve: (_m, c) => addMonths(c.today, 1) },

  { re: new RegExp(LEAD + String.raw`\bnext\s+year\b`, 'i'),
    resolve: (_m, c) => addMonths(c.today, 12) },

  { re: new RegExp(LEAD + String.raw`\bin\s+(\d{1,4})\s*(day|days|week|weeks|month|months|year|years)\b`, 'i'),
    resolve: (m, c) => {
      const n = Number(m[1])
      const unit = m[2].toLowerCase()
      if (unit.startsWith('day'))   return addDays(c.today, n)
      if (unit.startsWith('week'))  return addDays(c.today, n * 7)
      if (unit.startsWith('month')) return addMonths(c.today, n)
      return addMonths(c.today, n * 12)
    } },

  // "jan 27", "january 27 2027", "jan 27th"
  { re: new RegExp(LEAD + String.raw`\b(${MONTH_RE})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b`, 'i'),
    resolve: (m, c) => absolute(c, MONTH_NUM.get(m[1].toLowerCase())!, Number(m[2]), m[3]) },

  // "27 jan", "27th january 2027"
  { re: new RegExp(LEAD + String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(${MONTH_RE})\.?(?:,?\s+(\d{4}))?\b`, 'i'),
    resolve: (m, c) => absolute(c, MONTH_NUM.get(m[2].toLowerCase())!, Number(m[1]), m[3]) },

  // "3/4", "3/4/2027" — which number is the month follows `dateOrder`.
  { re: new RegExp(LEAD + String.raw`\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b`),
    resolve: (m, c) => {
      const a = Number(m[1]), b = Number(m[2])
      const [mo, d] = c.dateOrder === 'MDY' ? [a, b] : [b, a]
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
      let year = m[3] ? Number(m[3]) : undefined
      if (year !== undefined && year < 100) year += 2000
      return absolute(c, mo, d, year === undefined ? undefined : String(year))
    } },

  // Bare weekday, last so the qualified forms above get first refusal.
  { re: new RegExp(LEAD + String.raw`\b(${WEEKDAY_RE})\b`, 'i'),
    resolve: (m, c) => nextWeekday(c.today, WEEKDAY_NUM.get(m[1].toLowerCase())!) },
]

/**
 * A month/day with no year means the next one to come round: on 16 Sep, "jan
 * 27" is next January, not the one that has already gone. An explicit year is
 * taken at face value, including a past one — a backdated task is a real thing.
 *
 * The search runs forward over several years rather than just this one and
 * next, because "feb 29" is a legitimate date whose next occurrence can be
 * three years away. A day that exists in no year (feb 30) falls out of the loop
 * and is declined, which leaves it in the title rather than silently rounding
 * it to the 28th.
 */
const YEAR_SEARCH = 8

function absolute(ctx: Ctx, month: number, day: number, year?: string): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  if (year) {
    const y = Number(year)
    return day > daysInMonth(y, month) ? null : makeDay(y, month, day)
  }

  const { y: thisYear } = partsOf(ctx.today)
  for (let y = thisYear; y <= thisYear + YEAR_SEARCH; y++) {
    if (day > daysInMonth(y, month)) continue
    const candidate = makeDay(y, month, day)
    if (candidate >= ctx.today) return candidate
  }
  return null
}

// ── Time grammar ─────────────────────────────────────────────────────────────
//
// A time needs an am/pm, a colon, or a word like "noon". Bare "at 5" is
// deliberately not a time: it is far more often a quantity ("at 5 pages") than
// a clock reading, and guessing wrong silently schedules the wrong hour.

const TIME_RULES: { re: RegExp; resolve: (m: RegExpMatchArray) => number | null }[] = [
  { re: /(?:\bat\s+|@\s*)?\bnoon\b/i,     resolve: () => 12 * 60 },
  { re: /(?:\bat\s+|@\s*)?\bmidnight\b/i, resolve: () => 0 },

  // 5pm, 5:30pm, at 5 pm
  { re: /(?:\bat\s+|@\s*)?\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
    resolve: m => {
      let h = Number(m[1])
      const min = m[2] ? Number(m[2]) : 0
      if (h < 1 || h > 12 || min > 59) return null
      if (m[3].toLowerCase() === 'pm' && h !== 12) h += 12
      if (m[3].toLowerCase() === 'am' && h === 12) h = 0
      return h * 60 + min
    } },

  // 17:00, at 9:05
  { re: /(?:\bat\s+|@\s*)?\b(\d{1,2}):(\d{2})\b/,
    resolve: m => {
      const h = Number(m[1]), min = Number(m[2])
      if (h > 23 || min > 59) return null
      return h * 60 + min
    } },
]

// ── Recurrence grammar ───────────────────────────────────────────────────────
//
// Produces bare `FREQ=…` iCal strings with no "RRULE:" prefix — exactly what
// `tasks.rrule` stores and what `rrule-utils` accepts. Where a phrase coincides
// with one of the presets in `rrule-utils.PRESETS` the string is byte-identical,
// so the recurrence picker shows "Every Mon" rather than falling back to
// "custom": the grammar is another way to reach the same settings, not a
// parallel set of them.

/** RRULE weekday codes, indexed the way `dayOfWeek` counts: 0 = Sunday. */
const BYDAY_CODE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

export interface Recurrence {
  /** Bare `FREQ=…` string, for `tasks.rrule`. */
  rrule: string
  /**
   * The `!` in `every! 3 days` — count the next occurrence from when the task
   * is *finished* rather than from when it was due. Watering the plants every
   * three days means three days after you last watered them; a fortnightly
   * report means the 1st and the 15th whenever you get to it.
   */
  fromCompletion: boolean
  label: string
}

/** "every" / "each", carrying Todoist's `!` suffix. */
const EVERY = String.raw`\b(?:every|each)(!)?\s+`

const UNIT_FREQ: Record<string, string> = {
  day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY',
}

function rec(rrule: string, label: string, bang?: string): Recurrence {
  return { rrule, fromCompletion: !!bang, label }
}

function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/** Pull the day numbers out of "mon, wed and fri", in week order, deduplicated. */
function parseWeekdayList(list: string): number[] {
  const found = list.toLowerCase().match(new RegExp(WEEKDAY_RE, 'g')) ?? []
  const nums  = found.map(w => WEEKDAY_NUM.get(w)).filter((n): n is number => n !== undefined)
  return [...new Set(nums)].sort((a, b) => a - b)
}

const RECURRENCE_RULES: { re: RegExp; resolve: (m: RegExpMatchArray) => Recurrence | null }[] = [
  { re: new RegExp(EVERY + String.raw`last day of (?:the\s+)?month\b`, 'i'),
    resolve: m => rec('FREQ=MONTHLY;BYMONTHDAY=-1', 'Last day of the month', m[1]) },

  { re: new RegExp(EVERY + String.raw`other\s+(day|week|month|year)s?\b`, 'i'),
    resolve: m => rec(`FREQ=${UNIT_FREQ[m[2].toLowerCase()]};INTERVAL=2`,
                      `Every other ${m[2].toLowerCase()}`, m[1]) },

  { re: new RegExp(EVERY + String.raw`(\d{1,3})\s+(day|week|month|year)s?\b`, 'i'),
    resolve: m => {
      const n = Number(m[2])
      if (n < 1) return null
      const unit = m[3].toLowerCase()
      const freq = UNIT_FREQ[unit]
      // INTERVAL=1 is the default, so "every 1 week" and "every week" should
      // produce the same string — otherwise one of them misses its preset.
      return n === 1
        ? rec(`FREQ=${freq}`, `Every ${unit}`, m[1])
        : rec(`FREQ=${freq};INTERVAL=${n}`, `Every ${n} ${unit}s`, m[1])
    } },

  { re: new RegExp(EVERY + String.raw`weekdays?\b`, 'i'),
    resolve: m => rec('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'Every weekday', m[1]) },

  { re: new RegExp(EVERY + String.raw`weekends?\b`, 'i'),
    resolve: m => rec('FREQ=WEEKLY;BYDAY=SA,SU', 'Every weekend', m[1]) },

  // "every jan 27" — annual, on a fixed date.
  { re: new RegExp(EVERY + String.raw`(${MONTH_RE})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b`, 'i'),
    resolve: m => {
      const month = MONTH_NUM.get(m[2].toLowerCase())!
      const day   = Number(m[3])
      // Checked against a leap year, so "every feb 29" is allowed to exist.
      if (day < 1 || day > daysInMonth(2028, month)) return null
      return rec(`FREQ=YEARLY;BYMONTH=${month};BYMONTHDAY=${day}`,
                 `Every ${MON_NAMES[month - 1]} ${day}`, m[1])
    } },

  // "every 27th" — monthly, on that day of the month. The ordinal suffix is
  // required: bare "every 27" is indistinguishable from a count.
  { re: new RegExp(EVERY + String.raw`(\d{1,2})(?:st|nd|rd|th)\b`, 'i'),
    resolve: m => {
      const day = Number(m[2])
      if (day < 1 || day > 31) return null
      return rec(`FREQ=MONTHLY;BYMONTHDAY=${day}`, `Monthly on the ${ordinal(day)}`, m[1])
    } },

  // "every monday", "every mon, wed and fri"
  { re: new RegExp(
      EVERY + String.raw`((?:${WEEKDAY_RE})(?:\s*(?:,|and|&)\s*(?:${WEEKDAY_RE}))*)\b`, 'i'),
    resolve: m => {
      const days = parseWeekdayList(m[2])
      if (!days.length) return null
      return rec(`FREQ=WEEKLY;BYDAY=${days.map(d => BYDAY_CODE[d]).join(',')}`,
                 `Every ${days.map(d => DAY_NAMES[d].slice(0, 3)).join(', ')}`, m[1])
    } },

  { re: new RegExp(EVERY + String.raw`(day|week|month|year)s?\b`, 'i'),
    resolve: m => rec(`FREQ=${UNIT_FREQ[m[2].toLowerCase()]}`,
                      `Every ${m[2].toLowerCase()}`, m[1]) },

  // Bare adverbs. No `!` form — nobody types "daily!".
  { re: /\b(daily|weekly|monthly|yearly|annually)\b/i,
    resolve: m => {
      const word = m[1].toLowerCase()
      const freq = word === 'daily'   ? 'DAILY'
                 : word === 'weekly'  ? 'WEEKLY'
                 : word === 'monthly' ? 'MONTHLY'
                 : 'YEARLY'
      return rec(`FREQ=${freq}`, word[0].toUpperCase() + word.slice(1))
    } },
]

// ── Project, priority and estimate ───────────────────────────────────────────

/**
 * `#Project`, matched against the projects that exist.
 *
 * Case-insensitive, and a unique prefix is enough — `#pub` finds "Public
 * Policy" as long as nothing else starts that way. Ambiguity does not guess: two
 * projects matching means no match, and the token stays in the title where you
 * can see it went nowhere.
 *
 * A name with spaces needs braces — `#{Public Policy}` — because otherwise
 * there is no way to tell where the name stops and the task resumes.
 */
const PROJECT_RE = /#(?:\{([^}]{1,60})\}|([\p{L}\p{N}_-]{1,40}))/u

function matchProject(
  raw: string,
  projects: { id: string; name: string }[],
): { id: string; name: string } | null {
  const q = raw.trim().toLowerCase()
  if (!q) return null

  const exact = projects.filter(p => p.name.toLowerCase() === q)
  if (exact.length === 1) return exact[0]
  // An exact tie is unresolvable; a prefix tie is too.
  if (exact.length > 1) return null

  const prefix = projects.filter(p => p.name.toLowerCase().startsWith(q))
  return prefix.length === 1 ? prefix[0] : null
}

/**
 * `p1`–`p4`, on **Todoist's** scale: p1 is the most urgent.
 *
 * So the token inverts on the way in — `p1` stores priority 4 (Critical), `p4`
 * stores 1 (Low). This is a deliberate choice of the typed convention over the
 * stored one: `pN` is a Todoist idiom, people arrive with `p1` meaning "drop
 * everything", and a grammar that silently means the opposite of the habit it
 * borrows is worse than one that disagrees with a number elsewhere in the form.
 *
 * It does leave a visible inconsistency: the add-task form numbers its priority
 * buttons 1–4 with 4 as Critical, so typing `p1` lights up the button marked
 * `4`. The help page states the mapping outright rather than leaving that to be
 * discovered.
 */
const PRIORITY_RE = /\bp([1-4])\b/i

/**
 * Typed token → stored priority. The inversion lives here, in one table, so
 * there is exactly one place to look when the two numbers disagree.
 */
export const PRIORITY_FROM_TOKEN: Record<1 | 2 | 3 | 4, 1 | 2 | 3 | 4> = {
  1: 4,  // p1 — Critical
  2: 3,  // p2 — High
  3: 2,  // p3 — Medium
  4: 1,  // p4 — Low
}

/** `for 45m`, `for 2h`, `for 1h30m`, `for 90 minutes`. */
const ESTIMATE_RE =
  /\bfor\s+(?:(\d{1,3})\s*(?:h|hr|hrs|hours?)\s*(?:(\d{1,2})\s*(?:m|min|mins|minutes?)?)?|(\d{1,4})\s*(?:m|min|mins|minutes?))\b/i

function estimateFrom(m: RegExpMatchArray): number | null {
  const [, h, hm, mins] = m
  const total = h ? Number(h) * 60 + (hm ? Number(hm) : 0) : Number(mins)
  return Number.isFinite(total) && total > 0 && total <= 24 * 60 ? total : null
}

// ── Scanning ─────────────────────────────────────────────────────────────────

interface Hit { start: number; end: number; text: string }

/** First match by position; ties broken by the longer match. */
function firstMatch<T>(
  text: string,
  rules: { re: RegExp; resolve: (m: RegExpMatchArray, ctx: Ctx) => T | null }[],
  ctx: Ctx,
): (Hit & { value: T }) | null {
  let best: (Hit & { value: T }) | null = null
  for (const rule of rules) {
    const m = text.match(rule.re)
    if (!m || m.index === undefined) continue
    const value = rule.resolve(m, ctx)
    if (value === null) continue
    const hit = { start: m.index, end: m.index + m[0].length, text: m[0], value }
    if (!best || hit.start < best.start ||
        (hit.start === best.start && hit.end > best.end)) best = hit
  }
  return best
}

/** Blank out a span so a later scan can't match inside it, keeping offsets. */
function mask(text: string, start: number, end: number): string {
  return text.slice(0, start) + ' '.repeat(end - start) + text.slice(end)
}

// ── Labels ───────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MON_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** How a resolved day reads back to the user. */
export function formatDayLabel(day: string, today: string): string {
  if (day === today)                return 'Today'
  if (day === addDays(today, 1))    return 'Tomorrow'
  if (day === addDays(today, -1))   return 'Yesterday'

  const { y, m, d } = partsOf(day)
  // Inside the coming week the weekday name is the most useful handle.
  if (day > today && day <= addDays(today, 6)) return DAY_NAMES[dayOfWeek(day)]

  const sameYear = y === partsOf(today).y
  return sameYear ? `${d} ${MON_NAMES[m - 1]}` : `${d} ${MON_NAMES[m - 1]} ${y}`
}

/** The app's own priority names — 1 is Low here, not urgent. */
export const PRIORITY_NAME: Record<1 | 2 | 3 | 4, string> = {
  1: 'Low', 2: 'Medium', 3: 'High', 4: 'Critical',
}

/** "45m", "2h", "1h 30m" — the same shape `formatMinutes` uses on a task row. */
export function formatEstimateLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60), m = minutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

/** 12-hour clock, which is how the rest of the app shows times. */
export function formatTimeLabel(minutes: number): string {
  const h24 = Math.floor(minutes / 60), min = minutes % 60
  const suffix = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return min === 0 ? `${h12} ${suffix}` : `${h12}:${String(min).padStart(2, '0')} ${suffix}`
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Parse one quick-add string.
 *
 * Never throws and never returns a partially-applied result: text it does not
 * understand simply stays in the title, which is the behaviour that makes the
 * field safe to type into freely.
 */
export function parseQuickAdd(text: string, opts: QuickAddOptions): QuickAddResult {
  const ctx: Ctx = {
    today:     localDayStr(opts.now ?? new Date(), opts.tz),
    dateOrder: opts.dateOrder ?? 'MDY',
    weekStart: opts.weekStart ?? WEEK_START_DEFAULT,
  }

  const tokens: QuickAddToken[] = []
  let dueDay: string | null = null
  let timeMinutes: number | null = null
  let recurrence: Recurrence | null = null
  let projectId: string | null = null
  let priority: 1 | 2 | 3 | 4 | null = null
  let estimateMinutes: number | null = null
  let rest = text

  /**
   * The metadata tokens go first, before any of the date grammar.
   *
   * `#4th-floor` contains an ordinal the monthly rule would claim, `p1` is two
   * characters that no date pattern wants but the *estimate* might if it grew,
   * and `for 2h` contains a bare number. Scanning them first and masking each
   * span keeps every later pass looking only at text nobody has spoken for —
   * the same discipline recurrence-before-date already follows.
   */
  const projectMatch = rest.match(PROJECT_RE)
  if (projectMatch && projectMatch.index !== undefined) {
    const raw   = projectMatch[1] ?? projectMatch[2] ?? ''
    const found = matchProject(raw, opts.projects ?? [])
    if (found) {
      projectId = found.id
      const start = projectMatch.index, end = start + projectMatch[0].length
      rest = mask(rest, start, end)
      tokens.push({ start, end, type: 'project', text: projectMatch[0], label: found.name })
    }
    // No match: the token stays in the title, visibly doing nothing, rather
    // than becoming a project that does not exist.
  }

  const priorityMatch = rest.match(PRIORITY_RE)
  if (priorityMatch && priorityMatch.index !== undefined) {
    const typed = Number(priorityMatch[1]) as 1 | 2 | 3 | 4
    priority = PRIORITY_FROM_TOKEN[typed]
    const start = priorityMatch.index, end = start + priorityMatch[0].length
    rest = mask(rest, start, end)
    tokens.push({
      start, end, type: 'priority', text: priorityMatch[0],
      label: PRIORITY_NAME[priority],
    })
  }

  const estimateMatch = rest.match(ESTIMATE_RE)
  if (estimateMatch && estimateMatch.index !== undefined) {
    const mins = estimateFrom(estimateMatch)
    if (mins !== null) {
      estimateMinutes = mins
      const start = estimateMatch.index, end = start + estimateMatch[0].length
      rest = mask(rest, start, end)
      tokens.push({
        start, end, type: 'duration', text: estimateMatch[0],
        label: formatEstimateLabel(mins),
      })
    }
  }

  /**
   * Recurrence first, and this order is load-bearing: "every monday" contains a
   * weekday and "every jan 27" contains a date, so letting the date scanner run
   * first would strand a bare "every" in the title and set a one-off deadline
   * where a repeat was asked for.
   */
  const recHit = firstMatch(
    rest,
    RECURRENCE_RULES.map(r => ({ re: r.re, resolve: (m: RegExpMatchArray) => r.resolve(m) })),
    ctx,
  )
  if (recHit) {
    recurrence = recHit.value
    rest = mask(rest, recHit.start, recHit.end)
    tokens.push({
      start: recHit.start, end: recHit.end, type: 'recurrence',
      text: recHit.text, label: recHit.value.label,
    })
  }

  // Then the date, masked in turn so the time scan can't read the "27" of
  // "jan 27" or the "3/4" of a numeric date as a clock time.
  const dateHit = firstMatch(rest, DATE_RULES, ctx)
  if (dateHit) {
    dueDay = dateHit.value
    rest = mask(rest, dateHit.start, dateHit.end)
    tokens.push({
      start: dateHit.start, end: dateHit.end, type: 'date',
      text: dateHit.text, label: formatDayLabel(dateHit.value, ctx.today),
    })
  }

  const timeHit = firstMatch(
    rest,
    TIME_RULES.map(r => ({ re: r.re, resolve: (m: RegExpMatchArray) => r.resolve(m) })),
    ctx,
  )
  if (timeHit) {
    timeMinutes = timeHit.value
    tokens.push({
      start: timeHit.start, end: timeHit.end, type: 'time',
      text: timeHit.text, label: formatTimeLabel(timeHit.value),
    })
  }

  /**
   * A repeat with no date of its own still needs a first occurrence: "every
   * monday" is due the coming Monday, not undated. Asked of the rule itself
   * rather than derived here, so one implementation answers "when does this
   * fire" — and asked *inclusively*, because on a Monday "every monday" means
   * today rather than a week from today.
   *
   * An explicit date always wins, which is what makes "every day starting
   * friday" mean what it says.
   */
  if (recurrence && !dueDay) {
    dueDay = getFirstOccurrence(recurrence.rrule, ctx.today)
  }

  tokens.sort((a, b) => a.start - b.start)

  // Strip back to front so earlier offsets stay valid.
  let title = text
  for (const t of [...tokens].reverse()) {
    title = title.slice(0, t.start) + title.slice(t.end)
  }

  return {
    title: title.replace(/\s+/g, ' ').trim(),
    tokens,
    dueDay,
    dueISO: dueDay ? `${dueDay}T00:00:00.000Z` : null,
    timeMinutes,
    rrule: recurrence?.rrule ?? null,
    recurrenceFromCompletion: recurrence?.fromCompletion ?? false,
    projectId,
    priority,
    estimateMinutes,
  }
}
