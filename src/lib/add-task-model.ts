/**
 * The add-task modal's model: one owner per attribute.
 *
 * Every attribute a task or habit has is set by exactly one of these, in this
 * order of precedence:
 *
 *   typed    a fragment in the sentence the grammar understood
 *   set      a control under All fields, a quick pick, or the page that opened
 *            the modal (Upcoming passes the day of the column it came from)
 *   implied  what the text implies without naming it — a repeat's first day,
 *            the day a bare time next comes round
 *   guessed  ✦ Guess the rest, which only ever fills blanks
 *   default
 *
 * The sentence is the title field. Nothing is copied out of it into a second
 * set of fields; the receipt under it and the rows under All fields are both
 * read from `resolve`, so they cannot disagree with the text.
 *
 * Pure: no React, no clock, no network. Everything the modal decides is here
 * and tested in `add-task-model.test.ts`.
 */
import type { EnergyLevel, UrgencyCurve } from '@/types'
import {
  formatDayLabel, formatEstimateLabel, formatTimeLabel, PRIORITY_NAME,
  type QuickAddResult, type QuickAddToken, type TokenType,
} from './quick-add'
import { PRESETS, rruleToLabel } from './rrule-utils'
import { cadence } from './habit-stats'
import type { ParseFill } from './parse-task'

export type Mode = 'task' | 'habit'
export type Where = 'anywhere' | 'home' | 'away'
export interface Repeat { rrule: string; fromCompletion: boolean }

export interface Values {
  due: string | null
  /** Minutes past local midnight. */
  time: number | null
  repeat: Repeat | null
  notBefore: string | null
  curve: UrgencyCurve
  project: string | null
  /** Stored scale: 4 is Critical. */
  priority: 1 | 2 | 3 | 4
  /** A task's estimate, or a habit's session length — the same column. */
  estimate: number | null
  energy: EnergyLevel
  where: Where
  span: number | null
  buffer: number | null
  notes: string
  target: number | null
  avoidMeals: boolean
}
export type Key = keyof Values

export const DEFAULTS: Values = {
  due: null, time: null, repeat: null, notBefore: null, curve: 'linear', project: null,
  priority: 2, estimate: null, energy: 'medium', where: 'anywhere', span: null, buffer: null,
  notes: '', target: null, avoidMeals: false,
}

/** The attributes each kind of thing has, in the order the receipt lists them. */
export const KEYS: Record<Mode, readonly Key[]> = {
  task: ['due', 'time', 'repeat', 'notBefore', 'curve', 'project', 'priority', 'estimate', 'energy',
    'where', 'span', 'buffer', 'notes'],
  habit: ['target', 'repeat', 'estimate', 'priority', 'energy', 'avoidMeals', 'where', 'span', 'buffer', 'notes'],
}

/**
 * Which question a token answers. This is its highlight colour: date and time
 * are both "when", a repeat and a weekly target are both "how often".
 */
export type Group = 'when' | 'repeat' | 'project' | 'priority' | 'estimate' | 'label'
export const GROUP: Record<TokenType, Group> = {
  date: 'when', time: 'when', recurrence: 'repeat', target: 'repeat',
  project: 'project', priority: 'priority', duration: 'estimate', label: 'label',
}

const TOKEN_KEY: Partial<Record<TokenType, Key>> = {
  date: 'due', time: 'time', recurrence: 'repeat', target: 'target',
  project: 'project', priority: 'priority', duration: 'estimate',
}

export type Owner = 'typed' | 'set' | 'implied' | 'guessed' | 'default'
export interface Resolved<K extends Key = Key> {
  value: Values[K]
  owner: Owner
  /** The fragment behind a typed or implied value. */
  token?: QuickAddToken
}
export type Resolution = { [K in Key]: Resolved<K> }

function typedValue(k: Key, parse: QuickAddResult): Values[Key] {
  switch (k) {
    case 'due':      return parse.dueDay
    case 'time':     return parse.timeMinutes
    case 'repeat':   return parse.rrule ? { rrule: parse.rrule, fromCompletion: parse.recurrenceFromCompletion } : null
    case 'project':  return parse.projectId
    case 'priority': return parse.priority ?? DEFAULTS.priority
    case 'estimate': return parse.estimateMinutes
    case 'target':   return parse.weeklyTarget
    default:         return DEFAULTS[k]
  }
}

export function resolve(
  parse: QuickAddResult,
  set: Partial<Values>,
  guess: Partial<Values>,
): Resolution {
  const out = {} as Record<Key, Resolved>
  for (const k of Object.keys(DEFAULTS) as Key[]) {
    const token = parse.tokens.find(t => TOKEN_KEY[t.type] === k)
    if (token) { out[k] = { value: typedValue(k, parse), owner: 'typed', token }; continue }
    if (k in set) { out[k] = { value: set[k] as Values[Key], owner: 'set' }; continue }
    if (k === 'due' && parse.dueDay && (parse.dueFrom === 'time' || parse.dueFrom === 'recurrence')) {
      const via = parse.tokens.find(t => t.type === (parse.dueFrom === 'time' ? 'time' : 'recurrence'))
      out[k] = { value: parse.dueDay, owner: 'implied', token: via }
      continue
    }
    if (k in guess) { out[k] = { value: guess[k] as Values[Key], owner: 'guessed' }; continue }
    out[k] = { value: DEFAULTS[k], owner: 'default' }
  }
  return out as Resolution
}

/** Values that differ from the default — what the receipt bothers to list. */
export function isDefault(k: Key, v: Values[Key]): boolean {
  if (k === 'notes') return !String(v ?? '').trim()
  return JSON.stringify(v) === JSON.stringify(DEFAULTS[k])
}

// ── Words ────────────────────────────────────────────────────────────────────

export interface Ctx {
  today: string
  projects: { id: string; name: string }[]
}

function dayWord(day: string, today: string): string {
  const w = formatDayLabel(day, today)
  return /^(Today|Tomorrow|Yesterday)$/.test(w) ? w.toLowerCase() : w
}

export function repeatLabel(r: Repeat | null): string {
  if (!r) return 'No repeat'
  const preset = PRESETS.find(p => p.rrule === r.rrule)
  const base = preset ? preset.label : rruleToLabel(r.rrule).replace(/^./, c => c.toUpperCase())
  return r.fromCompletion ? `${base}, from when done` : base
}

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const
export type Weekday = typeof WEEKDAYS[number]
export const WEEKDAY_ORDER: readonly Weekday[] = WEEKDAYS
const WEEKDAY_NAME: Record<Weekday, string> = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' }

/** The weekdays a habit's rule picks, in week order. Every day for a plain daily rule. */
export function daysOf(r: Repeat | null): Weekday[] {
  if (!r) return []
  if (/^FREQ=DAILY$/.test(r.rrule)) return [...WEEKDAYS]
  const m = r.rrule.match(/BYDAY=([A-Z,]+)/)
  return m ? WEEKDAYS.filter(d => m[1].split(',').includes(d)) : []
}

/** Back from a set of weekdays to the rule, in the byte form the presets use. */
export function repeatFromDays(days: Weekday[]): Repeat | null {
  const sorted = WEEKDAYS.filter(d => days.includes(d))
  if (!sorted.length) return null
  if (sorted.length === 7) return { rrule: 'FREQ=DAILY', fromCompletion: false }
  return { rrule: `FREQ=WEEKLY;BYDAY=${sorted.join(',')}`, fromCompletion: false }
}

export function daysLabel(days: Weekday[], joiner = 'and'): string {
  if (days.length === 7) return 'every day'
  const names = days.map(d => WEEKDAY_NAME[d])
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} ${joiner} ${names[names.length - 1]}`
}

/** How a value reads in the receipt. */
export function describe(k: Key, v: Values[Key], ctx: Ctx, mode: Mode): string {
  switch (k) {
    case 'due':       return v ? `Due ${dayWord(v as string, ctx.today)}` : 'No due date'
    case 'time':      return v == null ? 'No time' : formatTimeLabel(v as number)
    case 'repeat': {
      if (mode === 'habit') {
        const d = daysOf(v as Repeat | null)
        return d.length ? daysLabel(d).replace(/^./, c => c.toUpperCase()) : 'Any day'
      }
      return repeatLabel(v as Repeat | null)
    }
    case 'notBefore': return `Not before ${dayWord(v as string, ctx.today)}`
    case 'curve':     return `${String(v).replace(/^./, c => c.toUpperCase())} urgency`
    case 'project':   return ctx.projects.find(p => p.id === v)?.name ?? 'No project'
    case 'priority':  return PRIORITY_NAME[v as 1 | 2 | 3 | 4]
    case 'estimate':  return mode === 'habit' ? `${formatEstimateLabel(v as number)} sessions` : formatEstimateLabel(v as number)
    case 'energy':    return `${String(v).replace(/^./, c => c.toUpperCase())} energy`
    case 'where':     return v === 'home' ? 'At home' : v === 'away' ? 'Out' : 'Anywhere'
    case 'span':      return `Ties me up ${formatEstimateLabel(v as number)}`
    case 'buffer':    return v === 0 ? 'No buffer' : `${v}m buffer`
    case 'notes':     return 'Notes'
    case 'target':    return cadence(v as number).label
    case 'avoidMeals': return 'Not after meals'
  }
}

// ── The receipt ──────────────────────────────────────────────────────────────

export interface ReceiptChip {
  kind: 'typed' | 'set' | 'guessed' | 'kept'
  label: string
  group?: Group
  key?: Key
  /** The fragment a typed or kept chip belongs to. */
  fragment?: string
  /** What its × does, for a screen reader. */
  undo: string
}

/**
 * Everything that will be created, in words: what was typed, in the order it
 * was typed, then what was set elsewhere, then Claude's guesses, then the
 * fragments kept as words. Nothing is in effect that isn't listed here.
 *
 * `rowsShown` is true under All fields, where each row already says who set
 * it; the receipt then lists only what has no row — the kept fragments.
 */
export function receipt(
  parse: QuickAddResult,
  r: Resolution,
  mode: Mode,
  ctx: Ctx,
  kept: string[],
  rowsShown = false,
): ReceiptChip[] {
  const out: ReceiptChip[] = []
  if (!rowsShown) {
    for (const t of parse.tokens) {
      const key = TOKEN_KEY[t.type]
      if (!key) continue
      let label = t.label
      if (t.type === 'time' && r.due.owner === 'implied' && r.due.token === t) label += ` ${dayWord(r.due.value!, ctx.today)}`
      if (t.type === 'recurrence') {
        if (parse.recurrenceFromCompletion) label += ', from when done'
        if (r.due.owner === 'implied' && r.due.token === t) label += ` · starts ${dayWord(r.due.value!, ctx.today)}`
      }
      if (t.type === 'duration' && mode === 'habit') label += ' sessions'
      out.push({ kind: 'typed', label, group: GROUP[t.type], key, fragment: t.text, undo: `Keep “${t.text}” as words` })
    }
    for (const kind of ['set', 'guessed'] as const) {
      for (const k of KEYS[mode]) {
        const x = r[k]
        if (x.owner !== kind || (kind === 'set' && isDefault(k, x.value))) continue
        const label = describe(k, x.value, ctx, mode)
        out.push({ kind, label, key: k, undo: kind === 'set' ? `Clear ${label}` : `Drop the guess ${label}` })
      }
    }
  }
  for (const f of kept) out.push({ kind: 'kept', label: `“${f}” kept as words`, fragment: f, undo: `Read “${f}” again` })
  return out
}

/** A habit's plan in one sentence, or what it still needs. */
export function habitPlan(r: Resolution): string {
  const t = r.target.value, s = r.estimate.value, days = daysOf(r.repeat.value)
  const some = days.length && days.length < 7 ? days : []
  if (t && s) return `Books ${t} × ${formatEstimateLabel(s)} on separate days each week${some.length ? `, on ${daysLabel(some, 'or')}` : ''}.`
  if (days.length && s) return `Books ${formatEstimateLabel(s)} on ${daysLabel(days)}.`
  if (t) return 'Pick a session length and it gets booked into your week.'
  if (s) return 'Pick how many times a week and it gets booked into your week.'
  return 'Say how often and for how long, and it gets booked into your week.'
}

// ── Changing things ──────────────────────────────────────────────────────────

/** The text with one token's span taken out, and the gap closed. */
export function withoutToken(text: string, t: { start: number; end: number }): string {
  const a = text.slice(0, t.start).replace(/[ \t]+$/, '')
  const b = text.slice(t.end).replace(/^[ \t]+/, '')
  return a && b ? `${a} ${b}` : a + b
}

export interface Draft {
  text: string
  set: Partial<Values>
}
export interface Handover extends Draft {
  /** Set when a typed fragment was taken out of the text, for Undo. */
  removed: { fragment: string; before: Draft } | null
}

/**
 * Set a value from a control.
 *
 * If the text owned that value, its fragment comes out of the text: you have
 * said the same thing twice, and the control is the newer of the two. Anything
 * the fragment was implying is pinned first, so removing "at 5pm" does not
 * also silently lose the day it put the task on. The caller offers Undo.
 */
export function setValue<K extends Key>(draft: Draft, r: Resolution, k: K, v: Values[K]): Handover {
  const owner = r[k]
  const set = { ...draft.set }
  let text = draft.text
  let removed: Handover['removed'] = null
  if (owner.owner === 'typed' && owner.token) {
    removed = { fragment: owner.token.text, before: draft }
    if (r.due.owner === 'implied' && r.due.token === owner.token && !('due' in set) && k !== 'due') set.due = r.due.value
    text = withoutToken(text, owner.token)
  }
  set[k] = v
  return { text, set, removed }
}

/** Offsets for the fragments kept as words, for `parseQuickAdd`'s `exclude`. */
export function excludeSpans(text: string, kept: string[]): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = []
  for (const f of kept) {
    const start = text.indexOf(f)
    if (start >= 0) spans.push({ start, end: start + f.length })
  }
  return spans
}

/** Claude's fill, in the modal's terms, limited to what this kind of thing has. */
export function guessFrom(fill: ParseFill, mode: Mode): Partial<Values> {
  const g: Partial<Values> = { energy: fill.energy }
  if (fill.dueDay) g.due = fill.dueDay
  if (fill.timeMinutes !== undefined) g.time = fill.timeMinutes
  if (fill.rrule) g.repeat = { rrule: fill.rrule, fromCompletion: !!fill.rruleFromCompletion }
  if (fill.projectId) g.project = fill.projectId
  if (fill.priority) g.priority = fill.priority
  if (fill.estimateMinutes) g.estimate = fill.estimateMinutes
  const keys = KEYS[mode]
  return Object.fromEntries(Object.entries(g).filter(([k]) => keys.includes(k as Key))) as Partial<Values>
}

// ── Saving ───────────────────────────────────────────────────────────────────

/**
 * What `createTask` is sent. A habit carries none of a task's dates, and a
 * time is only sent with a day — which, since a bare time now implies one, is
 * whenever a time was typed.
 */
export function toCreate(title: string, r: Resolution, mode: Mode) {
  const habit = mode === 'habit'
  const day = (d: string | null) => (d ? `${d}T00:00:00.000Z` : null)
  const due = habit ? null : r.due.value
  const repeat = r.repeat.value
  return {
    title: title.trim(),
    project_id: habit ? null : r.project.value,
    priority: r.priority.value,
    energy_required: r.energy.value,
    estimated_minutes: r.estimate.value,
    due_date: day(due),
    urgency_curve: habit ? 'linear' : r.curve.value,
    rrule: repeat?.rrule ?? null,
    rrule_from_completion: !!repeat?.fromCompletion,
    weekly_target: habit ? r.target.value : null,
    taskType: habit ? ('habit' as const) : undefined,
    description: r.notes.value.trim() || null,
    start_date: habit ? null : day(r.notBefore.value),
    location: r.where.value,
    span_minutes: r.span.value,
    buffer_minutes: r.buffer.value,
    avoid_after_breaks: habit && r.avoidMeals.value,
    due_time_minutes: due && r.time.value != null ? r.time.value : null,
  }
}
