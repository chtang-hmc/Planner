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
 * Stage 1 covers dates and times. Recurrence (`every monday`) and the metadata
 * tokens (`#project`, `p1`) are separate token types, already reserved in
 * `TokenType`, so adding them does not change this contract.
 */
import { addDays, dayOfWeek, localDayStr } from './day'
import { weekStartOfDay, WEEK_START_DEFAULT, WeekStartDay } from './week'

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
const LEAD = String.raw`(?:\b(?:due\s+)?(?:by|on|before)\s+|\bdue\s+)?`

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

  // Date first: it is the more specific grammar, and masking it stops the time
  // scan reading the "27" of "jan 27" or the "3/4" of a numeric date.
  const dateHit = firstMatch(text, DATE_RULES, ctx)
  let rest = text
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
  }
}
