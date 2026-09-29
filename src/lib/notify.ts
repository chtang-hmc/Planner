/**
 * What the notifications say, and when each one is due. Pure: the scheduler in
 * `lib/notify-run.ts` reads the database, hands the rows here, and sends
 * whatever comes back.
 *
 * **Three sends a day, not a dozen.** Six of the chosen notifications happen in
 * the morning (due today, overdue, critical tomorrow, weekly targets, inbox,
 * review), and six buzzes at 8am is how notifications get turned off. They are
 * lines of one morning message instead, each switchable on its own. Habits
 * get an evening reminder and the day gets a wrap-up; milestones and a broken
 * calendar sync go out when they happen. Chosen 2026-09-28.
 */

import type { TaskType } from '@/types'
import type { HabitSummary } from '@/lib/habit-stats'
import { cadence, streakWords } from '@/lib/habit-stats'
import { addDays } from '@/lib/day'
import { weekStartOfDay } from '@/lib/week'
import { formatMinutes, formatTimeOfDay } from '@/lib/task-format'
import type { PushMessage } from '@/lib/push'

// ── Preferences ───────────────────────────────────────────────────────────────

export const NOTIFY_KINDS = [
  'dueToday', 'overdue', 'criticalTomorrow', 'weeklyTarget', 'inbox', 'review',
  'habitReminder', 'streakRisk', 'milestone', 'wrapUp', 'calendar',
] as const
export type NotifyKind = typeof NOTIFY_KINDS[number]

export interface NotifyPrefs {
  /** Minutes past local midnight. */
  morningAt:      number
  habitsAt:       number
  wrapUpAt:       number
  /** The inbox line appears at this many unsorted tasks or more. */
  inboxThreshold: number
  on:             Record<NotifyKind, boolean>
}

export const DEFAULT_PREFS: NotifyPrefs = {
  morningAt:      8 * 60,
  habitsAt:       20 * 60,
  wrapUpAt:       21 * 60,
  // 18 open tasks on 2026-09-28, one of them without a project. Five unsorted
  // is a third of everything, which is a pile.
  inboxThreshold: 5,
  on: Object.fromEntries(NOTIFY_KINDS.map(k => [k, true])) as Record<NotifyKind, boolean>,
}

/** What Settings shows beside each switch, in the order it shows them. */
export const KIND_LABELS: Record<NotifyKind, { label: string; slot: 'morning' | 'habits' | 'wrapUp' | 'instant' }> = {
  dueToday:         { label: 'How many tasks are due today, with a line to start on', slot: 'morning' },
  overdue:          { label: 'Tasks that went overdue yesterday',                      slot: 'morning' },
  criticalTomorrow: { label: 'Critical tasks due tomorrow',                            slot: 'morning' },
  weeklyTarget:     { label: 'Weekly habit targets running out of days',               slot: 'morning' },
  inbox:            { label: 'Tasks piling up without a project',                      slot: 'morning' },
  review:           { label: 'Weekly review, on the first day of the week',            slot: 'morning' },
  habitReminder:    { label: 'Habits not done yet today',                              slot: 'habits'  },
  streakRisk:       { label: 'A streak of 3 or more about to break',                   slot: 'habits'  },
  wrapUp:           { label: 'What got done today, and what is still open',            slot: 'wrapUp'  },
  milestone:        { label: 'Streak milestones (7, 30, 100 days…)',                   slot: 'instant' },
  calendar:         { label: 'Google Calendar stopped syncing',                        slot: 'instant' },
}

const isMinute = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 24 * 60

/** Whatever is stored, as a complete set of preferences. Unknown or bad fields fall back. */
export function normalizePrefs(raw: unknown): NotifyPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof NotifyPrefs, unknown>>
  const on = (r.on && typeof r.on === 'object' ? r.on : {}) as Record<string, unknown>
  return {
    morningAt:      isMinute(r.morningAt) ? r.morningAt : DEFAULT_PREFS.morningAt,
    habitsAt:       isMinute(r.habitsAt)  ? r.habitsAt  : DEFAULT_PREFS.habitsAt,
    wrapUpAt:       isMinute(r.wrapUpAt)  ? r.wrapUpAt  : DEFAULT_PREFS.wrapUpAt,
    inboxThreshold: Number.isInteger(r.inboxThreshold) && (r.inboxThreshold as number) >= 1
                      ? r.inboxThreshold as number : DEFAULT_PREFS.inboxThreshold,
    on: Object.fromEntries(NOTIFY_KINDS.map(k =>
      [k, typeof on[k] === 'boolean' ? on[k] : DEFAULT_PREFS.on[k]])) as Record<NotifyKind, boolean>,
  }
}

// ── When ──────────────────────────────────────────────────────────────────────

/**
 * How late a daily send may still go out. The scheduler ticks every five
 * minutes; this covers a few missed ticks without sending a morning summary at
 * lunchtime.
 */
export const SEND_WINDOW_MINUTES = 90

/** Whether `now` (minutes past local midnight) is inside the send window for `at`. */
export function inWindow(now: number, at: number, window = SEND_WINDOW_MINUTES): boolean {
  return now >= at && now < at + window
}

/**
 * Hours in which an unscheduled notification may go out: from the morning
 * send until 10pm. A sync that breaks at 3am is reported at breakfast.
 */
export function awake(now: number, prefs: NotifyPrefs): boolean {
  return now >= prefs.morningAt && now < 22 * 60
}

// ── Inputs ────────────────────────────────────────────────────────────────────

export interface OpenTask {
  id:        string
  title:     string
  type:      TaskType
  priority:  number
  /** YYYY-MM-DD, as the due date slices; null if undated. */
  dueDay:    string | null
  parentId:  string | null
  projectId: string | null
  urgency:   number
}

export interface HabitState {
  title:        string
  weeklyTarget: number | null
  doneToday:    boolean
  summary:      HabitSummary
}

export interface DoneRow {
  type:    TaskType
  minutes: number | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** "A", "A and B", "A, B and C", "A, B and 3 more". */
export function names(list: string[], max = 3): string {
  if (list.length <= max) {
    return list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
  }
  return `${list.slice(0, max - 1).join(', ')} and ${list.length - (max - 1)} more`
}

/** Whole days from `a` to `b`. Same as `lib/home`'s, which is not imported so Settings does not ship the scheduler. */
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000)

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Pieces of work matching `when`, as Home counts them: a subtask without a
 * date takes its parent's, and a parent with its steps is one piece, named
 * after the parent. Habits and someday tasks are never "due".
 */
export function duePieces(tasks: OpenTask[], when: (day: string) => boolean): { title: string; urgency: number; priority: number }[] {
  const byId = new Map(tasks.map(t => [t.id, t]))
  const groups = new Map<string, { title: string; urgency: number; priority: number }>()
  for (const t of tasks) {
    if (t.type === 'habit' || t.type === 'someday') continue
    const parent = t.parentId ? byId.get(t.parentId) : undefined
    const day = t.dueDay ?? parent?.dueDay ?? null
    if (!day || !when(day)) continue
    const key = t.parentId ?? t.id
    const prev = groups.get(key)
    groups.set(key, {
      title:    parent?.title ?? t.title,
      urgency:  Math.max(prev?.urgency ?? 0, t.urgency),
      priority: Math.max(prev?.priority ?? 0, t.priority, parent?.priority ?? 0),
    })
  }
  return [...groups.values()].sort((a, b) => b.urgency - a.urgency)
}

/** A stable pick from `options` for the day, so the wording varies but a re-send says the same thing. */
function pick<T>(options: T[], day: string): T {
  let h = 0
  for (const c of day) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return options[h % options.length]
}

/** The line under "N due today", in the tone the count deserves. */
export function motivation(count: number, top: string | null, day: string): string {
  const t = top ?? 'the first one'
  if (count === 0) return pick([
    'Nothing due today. A good day to get ahead on something that matters.',
    'A clear day. Pick one thing that moves you forward.',
    'No deadlines today, so spend it on what is important rather than urgent.',
  ], day)
  if (count <= 2) return pick([
    `A light day. Start with ${t} and the rest is a bonus.`,
    `Only ${count === 1 ? 'one' : 'two'} due. Get ${t} done early and enjoy the space.`,
    `Short list today. ${t} first.`,
  ], day)
  if (count <= 5) return pick([
    `A solid day. Start with ${t} and keep the momentum going.`,
    `Very doable. ${t} first, then one at a time.`,
    `A full but manageable day. Knock out ${t} before anything else.`,
  ], day)
  return pick([
    `A heavy day. Do ${t} first, then take the rest one at a time.`,
    `A lot is due. Not all of it has to be perfect. Start with ${t}.`,
    `Big day. Protect your time for ${t} before the rest crowds in.`,
  ], day)
}

// ── The morning message ───────────────────────────────────────────────────────

export interface MorningInput {
  today:         string
  weekStartDay:  number
  tasks:         OpenTask[]
  habits:        HabitState[]
  /** When the last weekly review was saved, or null if never. */
  lastReviewISO: string | null
  nowISO:        string
  prefs:         NotifyPrefs
}

/**
 * A weekly habit is at risk when it has at most one day of slack left: the
 * days remaining (today included, unless it is already done today) are barely
 * enough for the sessions still needed. One already out of reach is left
 * alone; there is nothing to do about it.
 */
export function weeklyAtRisk(h: HabitState, today: string, weekStartDay: number): { needed: number; daysLeft: number } | null {
  const c = cadence(h.weeklyTarget)
  if (c.kind !== 'weekly') return null
  const needed = c.target! - h.summary.thisWeek
  if (needed <= 0) return null
  const weekStart = weekStartOfDay(today, weekStartDay)
  const daysLeft = 7 - daysBetween(weekStart, today) - (h.doneToday ? 1 : 0)
  if (needed > daysLeft || needed < daysLeft - 1) return null
  return { needed, daysLeft }
}

export function composeMorning(input: MorningInput): PushMessage | null {
  const { today, tasks, habits, prefs, weekStartDay } = input
  const on = prefs.on
  const lines: string[] = []
  let title = 'Good morning'

  if (on.dueToday) {
    const due = duePieces(tasks, d => d === today)
    title = due.length === 0 ? 'Nothing due today' : `${plural(due.length, 'task')} due today`
    lines.push(motivation(due.length, due[0]?.title ?? null, today))
  }

  if (on.overdue) {
    const yesterday = addDays(today, -1)
    const late = duePieces(tasks, d => d === yesterday)
    if (late.length) lines.push(`Went overdue yesterday: ${names(late.map(p => p.title))}.`)
  }

  if (on.criticalTomorrow) {
    const tomorrow = addDays(today, 1)
    const critical = duePieces(tasks, d => d === tomorrow).filter(p => p.priority >= 4)
    if (critical.length) lines.push(`Critical, due tomorrow: ${names(critical.map(p => p.title))}.`)
  }

  if (on.weeklyTarget) {
    for (const h of habits) {
      const risk = weeklyAtRisk(h, today, weekStartDay)
      if (!risk) continue
      lines.push(`${h.title}: ${h.summary.thisWeek} of ${h.weeklyTarget} this week, ${plural(risk.daysLeft, 'day')} left.`)
    }
  }

  if (on.inbox) {
    const unsorted = tasks.filter(t => !t.projectId && !t.parentId && t.type !== 'habit').length
    if (unsorted >= prefs.inboxThreshold) lines.push(`${plural(unsorted, 'task')} in the inbox with no project. Worth a few minutes to sort.`)
  }

  if (on.review) {
    const isWeekStart = weekStartOfDay(today, weekStartDay) === today
    // Done in the last two days counts: a review on Sunday night is this week's.
    const recent = input.lastReviewISO !== null
      && Date.parse(input.nowISO) - Date.parse(input.lastReviewISO) < 2 * 86_400_000
    if (isWeekStart && !recent) lines.push('New week: time for the weekly review.')
  }

  if (!lines.length) return null
  return { title, body: lines.join('\n'), url: '/', tag: `morning-${today}` }
}

// ── The evening habit reminder ────────────────────────────────────────────────

export interface HabitsInput {
  today:        string
  weekStartDay: number
  habits:       HabitState[]
  prefs:        NotifyPrefs
}

/**
 * Which habits still want doing today.
 *
 * Daily habits: not done today. Weekly: not done today and short on days, by
 * `weeklyAtRisk`'s rule. Anytime habits never promised anything, so they are never
 * nagged about. A streak is "at risk" at 3 or more: a daily one not done
 * today, or a weekly one whose target now needs every remaining day.
 */
/** "12-day streak", "3-week streak". */
function streakPhrase(s: { value: number; unit: 'd' | 'w' }): string {
  return `${s.value}-${s.unit === 'd' ? 'day' : 'week'} streak`
}

export function habitsLeft(input: HabitsInput): { title: string; note: string; atRisk: boolean }[] {
  const { habits, today, weekStartDay } = input
  const out: { title: string; note: string; atRisk: boolean }[] = []
  for (const h of habits) {
    if (h.doneToday) continue
    const c = cadence(h.weeklyTarget)
    const streak = h.summary.streak
    if (c.kind === 'daily') {
      const atRisk = !!streak && streak.value >= 3
      out.push({ title: h.title, note: atRisk ? streakPhrase(streak!) : 'daily', atRisk })
    } else if (c.kind === 'weekly') {
      // Only once the week is running short, by the same rule as the morning
      // line: a 2×-a-week habit is not "left today" on a Monday.
      const risk = weeklyAtRisk(h, today, weekStartDay)
      if (!risk) continue
      const atRisk = !!streak && streak.value >= 3 && risk.needed === risk.daysLeft
      out.push({
        title: h.title,
        note: atRisk ? streakPhrase(streak!) : `${h.summary.thisWeek} of ${c.target} this week`,
        atRisk,
      })
    }
  }
  return out
}

export function composeHabits(input: HabitsInput): PushMessage | null {
  const { on } = input.prefs
  const left = habitsLeft(input)
  const risky = left.filter(h => h.atRisk)
  const shown = on.habitReminder ? left : on.streakRisk ? risky : []
  if (!shown.length) return null

  const title = on.streakRisk && risky.length === 1
    ? `Keep your ${risky[0].note}: ${risky[0].title}`
    : on.streakRisk && risky.length > 1
      ? `${risky.length} streaks end tonight`
      : `${plural(shown.length, 'habit')} left today`
  const body = shown.map(h => `${h.title} (${h.note})`).join(', ')
  return { title, body, url: '/habits', tag: `habits-${input.today}` }
}

// ── The wrap-up ───────────────────────────────────────────────────────────────

export function composeWrapUp(input: { today: string; done: DoneRow[]; tasks: OpenTask[] }): PushMessage | null {
  const tasksDone  = input.done.filter(d => d.type !== 'habit').length
  const habitsDone = input.done.filter(d => d.type === 'habit').length
  const minutes    = input.done.reduce((s, d) => s + (d.minutes ?? 0), 0)
  const open       = duePieces(input.tasks, d => d === input.today)
  if (!tasksDone && !habitsDone && !open.length) return null

  const doneBits = [
    tasksDone  ? plural(tasksDone, 'task')   : null,
    habitsDone ? plural(habitsDone, 'habit') : null,
  ].filter(Boolean).join(' and ')

  const title = doneBits ? `Today: ${doneBits} done` : "Today's wrap-up"
  const lines = [
    minutes > 0 ? `${formatMinutes(minutes)} logged.` : null,
    open.length ? `Still due today: ${names(open.map(p => p.title))}.` : 'Everything due today is done.',
  ].filter(Boolean)
  return { title, body: lines.join(' '), url: '/', tag: `wrapup-${input.today}` }
}

// ── Instant ones ──────────────────────────────────────────────────────────────

const MILESTONES = { d: [7, 30, 100, 365], w: [4, 12, 26, 52] } as const

/**
 * A streak that has just reached a milestone.
 *
 * "Just": done today or yesterday. Yesterday counts because a daily streak is
 * counted from yesterday until today's is logged, so a streak that reached 7
 * at 11pm would otherwise miss its message. Each has a key the scheduler logs,
 * so it is said once: the day it was done for a daily habit, the week for a
 * weekly one (a weekly streak holds its value for the whole week).
 */
export function milestones(habits: HabitState[], today: string, weekStartDay: number): { key: string; message: PushMessage }[] {
  const out: { key: string; message: PushMessage }[] = []
  for (const h of habits) {
    const s = h.summary.streak
    const last = h.summary.lastDone
    if (!s || !last || last < addDays(today, -1)) continue
    if (!(MILESTONES[s.unit] as readonly number[]).includes(s.value)) continue
    const anchor = s.unit === 'd' ? last : weekStartOfDay(last, weekStartDay)
    out.push({
      key: `milestone:${h.title}:${s.value}${s.unit}:${anchor}`,
      message: {
        title: `${streakWords(s)} of ${h.title}`,
        body: s.value === (s.unit === 'd' ? 7 : 4)
          ? 'Your first milestone. This is how habits stick.'
          : `A ${streakWords(s)} streak. Keep it going.`,
        url: '/habits',
        tag: `milestone-${h.title}`,
      },
    })
  }
  return out
}

/** A sync older than this means the hourly job has stopped working. */
export const CALENDAR_STALE_HOURS = 6

export function composeCalendar(input: { connected: boolean; lastSyncedISO: string | null; nowISO: string }): PushMessage | null {
  if (!input.connected) return null
  const hours = input.lastSyncedISO === null ? Infinity
    : (Date.parse(input.nowISO) - Date.parse(input.lastSyncedISO)) / 3_600_000
  if (hours < CALENDAR_STALE_HOURS) return null
  return {
    title: 'Google Calendar stopped syncing',
    body: Number.isFinite(hours)
      ? `Last synced ${Math.floor(hours)} hours ago, so today's plan may be missing events. Open Settings to reconnect.`
      : 'It has never synced. Open Settings to reconnect.',
    url: '/settings',
    tag: 'calendar',
  }
}

/** "8 AM", for Settings. */
export { formatTimeOfDay as formatSendTime }
