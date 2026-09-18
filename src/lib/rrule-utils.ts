/**
 * RRULE helpers — wraps the `rrule` library for use throughout the app.
 *
 * We keep all rrule imports here so the rest of the codebase never needs to
 * touch the library directly.  Strings we produce are valid iCal RRULE strings
 * (no leading "RRULE:" prefix) so they can be stored verbatim in tasks.rrule.
 */
import { RRule, rrulestr } from 'rrule'

// ── Preset IDs ────────────────────────────────────────────────────────────────
export type RecurrencePreset =
  | 'none'
  | 'daily'
  | 'weekdays'
  | 'weekly_mon'
  | 'weekly_tue'
  | 'weekly_wed'
  | 'weekly_thu'
  | 'weekly_fri'
  | 'weekly_sat'
  | 'weekly_sun'
  | 'monthly'
  | 'custom'

export interface PresetOption {
  id: RecurrencePreset
  label: string
  rrule: string | null // null = no recurrence
}


export const PRESETS: PresetOption[] = [
  { id: 'none',        label: 'No repeat',  rrule: null },
  { id: 'daily',       label: 'Daily',      rrule: 'FREQ=DAILY' },
  { id: 'weekdays',    label: 'Weekdays',   rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { id: 'weekly_mon',  label: 'Every Mon',  rrule: 'FREQ=WEEKLY;BYDAY=MO' },
  { id: 'weekly_tue',  label: 'Every Tue',  rrule: 'FREQ=WEEKLY;BYDAY=TU' },
  { id: 'weekly_wed',  label: 'Every Wed',  rrule: 'FREQ=WEEKLY;BYDAY=WE' },
  { id: 'weekly_thu',  label: 'Every Thu',  rrule: 'FREQ=WEEKLY;BYDAY=TH' },
  { id: 'weekly_fri',  label: 'Every Fri',  rrule: 'FREQ=WEEKLY;BYDAY=FR' },
  { id: 'weekly_sat',  label: 'Every Sat',  rrule: 'FREQ=WEEKLY;BYDAY=SA' },
  { id: 'weekly_sun',  label: 'Every Sun',  rrule: 'FREQ=WEEKLY;BYDAY=SU' },
  { id: 'monthly',     label: 'Monthly',    rrule: 'FREQ=MONTHLY' },
]

/**
 * Match an rrule string back to a preset id, or return 'custom' if it doesn't
 * match any preset (so we can show it as a read-only label).
 */
export function rruleToPreset(rrule: string | null): RecurrencePreset {
  if (!rrule) return 'none'
  const match = PRESETS.find(p => p.rrule === rrule)
  return match ? match.id : 'custom'
}

/**
 * Human-readable label for an rrule string, falling back gracefully if the
 * string isn't a known preset.
 */
export function rruleToLabel(rrule: string | null): string {
  if (!rrule) return 'No repeat'
  const preset = PRESETS.find(p => p.rrule === rrule)
  if (preset) return preset.label

  // Try to parse it with the library and describe it
  try {
    const rule = RRule.fromString(rrule)
    return rule.toText()
  } catch {
    return rrule
  }
}

/**
 * Given a recurring task's rrule string and a reference date, compute the
 * next occurrence date strictly after that date.
 *
 * Returns a YYYY-MM-DD string, or null if there are no future occurrences.
 *
 * We use `rrulestr` (the library's iCal parser) with an explicit `dtstart`
 * option rather than building a multiline string — `RRule.fromString` requires
 * `RRULE:FREQ=…` (with prefix) and chokes on bare `FREQ=…` in a DTSTART block.
 */
export function getNextOccurrence(rruleStr: string, afterDate: Date): string | null {
  try {
    // rrulestr accepts 'FREQ=DAILY', 'RRULE:FREQ=DAILY', or full VEVENT blocks.
    // Passing dtstart here sets the rule's anchor without touching the stored string.
    // Use midnight UTC of afterDate so day-boundary arithmetic is timezone-stable.
    const anchor = startOfDayUTC(afterDate)
    const rule = rrulestr(rruleStr, { dtstart: anchor })
    const next = rule.after(anchor, /* inc = */ false)
    if (!next) return null
    return toYYYYMMDD(next)
  } catch {
    return null
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Midnight UTC on the same calendar day as d. */
function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/** Format a Date as YYYY-MM-DD for storing as a task due_date. Uses UTC day. */
function toYYYYMMDD(d: Date): string {
  // Pad with leading zeros so single-digit months/days are formatted correctly
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * The first occurrence of a rule on or after a given day.
 *
 * Distinct from `getNextOccurrence`, which is strictly *after* its anchor
 * because it answers "the one after the one just completed". This one answers
 * "when does this rule first fire", which is what a task typed as `every
 * monday` needs for its own due date — and on a Monday that has to be today,
 * not a week away.
 *
 * Takes and returns day strings, so nothing here can drift across a timezone.
 */
export function getFirstOccurrence(rruleStr: string, onOrAfterDay: string): string | null {
  try {
    const anchor = new Date(onOrAfterDay + 'T00:00:00Z')
    const next = rrulestr(rruleStr, { dtstart: anchor }).after(anchor, /* inc = */ true)
    return next ? toYYYYMMDD(next) : null
  } catch {
    return null
  }
}
