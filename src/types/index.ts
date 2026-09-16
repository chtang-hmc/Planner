// ─────────────────────────────────────────────────────────────────────────────
// Core domain types — shared between frontend and API routes
// ─────────────────────────────────────────────────────────────────────────────

export type TaskStatus   = 'inbox' | 'active' | 'done' | 'cancelled'
export type TaskType     = 'task' | 'someday' | 'recurring' | 'habit'
export type EnergyLevel  = 'low' | 'medium' | 'high'
export type UrgencyCurve = 'linear' | 'exponential' | 'step'

export interface Project {
  id: string
  name: string
  color: string       // hex, e.g. "#4338c9"
  archived: boolean
  created_at: string
}

export interface Task {
  id: string
  project_id: string | null      // null = unassigned / inbox
  parent_id: string | null       // set on subtasks
  title: string
  description: string | null
  status: TaskStatus
  type: TaskType
  priority: 1 | 2 | 3 | 4       // 4 = critical
  energy_required: EnergyLevel
  estimated_minutes: number | null   // user's estimate
  adjusted_minutes: number | null    // bias-corrected by system
  actual_minutes: number | null      // logged after completion
  due_date: string | null            // ISO timestamp
  start_date: string | null          // earliest it may be scheduled; null = now
  urgency_score: number              // 0–100, recomputed nightly
  urgency_curve: UrgencyCurve
  rrule: string | null               // iCal RRULE string for recurring tasks
  weekly_target: number | null       // habits only: how many times per week to aim for
  exclusive_group: string | null     // habits only: habits sharing a group are never scheduled on the same day
  location: 'home' | 'away' | 'anywhere'   // where it happens; gates what can run during a tether
  span_minutes: number | null        // total tie-up when longer than the work itself (laundry cycle)
  buffer_minutes: number | null      // transition padding override; null = global default, 0 = none
  gcal_event_id: string | null       // GCal event id for scheduled focus block
  scheduled_start: string | null     // ISO timestamp — start of focus block
  scheduled_end: string | null       // ISO timestamp — end of focus block
  created_at: string
  completed_at: string | null
  // joined relations (optional, populated by specific queries)
  project?: Project
  subtasks?: Task[]
}

export interface FocusSession {
  id: string
  task_id: string
  started_at: string
  ended_at: string | null
  duration_minutes: number | null
  estimate_accurate: boolean | null  // post-task reflection
  blocker_note: string | null
}

export interface EstimationProfile {
  id: string
  project_id: string
  sample_count: number
  bias_ratio: number      // actual ÷ estimated  (1.0 = accurate, 1.4 = 40% under)
  updated_at: string
}

export interface EnergyLog {
  id: string
  logged_at: string
  level: 1 | 2 | 3 | 4 | 5
  task_id: string | null
}

export interface EnergyPattern {
  hour_of_day: number    // 0–23
  day_of_week: number    // 0–6 (0 = Sunday)
  avg_level: number
  sample_count: number
  computed_at: string
}

export interface HabitStreak {
  task_id: string              // PK — habit is a recurring task
  current_streak: number
  longest_streak: number
  last_completed: string       // date string YYYY-MM-DD
  completions_this_week: number  // resets each Monday; tracks weekly goal progress
  week_start: string | null    // Monday of the current tracking week (YYYY-MM-DD)
}

export interface CalendarEvent {
  id: string
  gcal_id: string
  title: string
  start_time: string
  end_time: string
  all_day: boolean
  source: 'google_calendar' | 'gmail_parsed'
}

export interface WeeklyReview {
  id: string
  week_start: string     // Monday date
  completed_at: string
  completed_count: number
  postponed_count: number
  notes: string | null
}

// ── Urgency computation ─────────────────────────────────────────────────────
//
// Urgency = priority (10–40) + time pressure (0–60), capped at 100.
//
// Time pressure is a function of TIME REMAINING, not of how far the task is
// through its own lifespan. The previous formula used
// `elapsed / (due_date - created_at)`, which put the creation date in the
// denominator: two tasks with identical priority and deadline scored
// differently purely because one was written down earlier. A task added today
// and due Friday is under exactly the same pressure as one added last Monday
// and due Friday — the deadline is what's real, the creation date is an
// accident of when it got typed in.
//
// Pressure ramps over a fixed lead-in window rather than the task's lifespan,
// so the score is comparable across every task in the list.

/** Days before the deadline at which pressure starts to build. */
export const URGENCY_HORIZON_DAYS = 14

/** Pressure available before the deadline; the rest is reserved for overdue. */
const ON_TIME_PRESSURE = 50
const OVERDUE_PRESSURE = 10
/** Days overdue at which the overdue component maxes out. */
const OVERDUE_RAMP_DAYS = 7

/**
 * Maps ramp position (0 = horizon away, 1 = deadline) to a 0–1 multiplier.
 * Normalised so every curve starts at 0 and reaches exactly 1 at the deadline,
 * which keeps the curves comparable to each other.
 */
function curveShape(r: number, curve: UrgencyCurve): number {
  switch (curve) {
    case 'linear':
      return r
    case 'exponential': {
      // Sigmoid centred at 0.75 — flat for most of the window, then steep.
      const s = (x: number) => 1 / (1 + Math.exp(-10 * (x - 0.75)))
      return (s(r) - s(0)) / (s(1) - s(0))
    }
    case 'step':
      return r > 0.85 ? 1 : r > 0.6 ? 0.4 : 0.08
  }
}

function daysUntil(dueISO: string): number {
  return (new Date(dueISO).getTime() - Date.now()) / 86_400_000
}

export function computeUrgency(task: Pick<Task, 'priority' | 'urgency_curve' | 'due_date' | 'created_at'>): number {
  return computeUrgencyBreakdown(task).score
}

export interface UrgencyBreakdown {
  score:        number
  priorityPts:  number   // 10–40
  timePressure: number   // 0–60; 0 when no due date
  /** 0 = deadline is a horizon or more away, 1 = due now or overdue. */
  ramp:         number
  /** Negative once overdue. null when the task has no due date. */
  daysLeft:     number | null
  hasDueDate:   boolean
}

/** Same math as computeUrgency, with each component exposed for display. */
export function computeUrgencyBreakdown(
  task: Pick<Task, 'priority' | 'urgency_curve' | 'due_date' | 'created_at'>
): UrgencyBreakdown {
  const priorityPts = task.priority * 10

  if (!task.due_date) {
    return {
      score: Math.min(priorityPts, 100),
      priorityPts, timePressure: 0, ramp: 0, daysLeft: null, hasDueDate: false,
    }
  }

  const daysLeft = daysUntil(task.due_date)
  const ramp     = Math.max(0, Math.min(1 - daysLeft / URGENCY_HORIZON_DAYS, 1))

  const onTime = curveShape(ramp, task.urgency_curve ?? 'linear') * ON_TIME_PRESSURE
  // Past the deadline pressure keeps climbing, so a task three days late
  // outranks one due this afternoon rather than tying with it.
  const overdue = daysLeft < 0
    ? Math.min(1, -daysLeft / OVERDUE_RAMP_DAYS) * OVERDUE_PRESSURE
    : 0

  const timePressure = onTime + overdue
  return {
    score: Math.min(priorityPts + timePressure, 100),
    priorityPts, timePressure, ramp, daysLeft, hasDueDate: true,
  }
}

// ── Inbox / unassigned sentinel ─────────────────────────────────────────────
// Used wherever a Task has no project_id — renders as "Inbox" in the UI
export const INBOX_PROJECT: Project = {
  id: '',
  name: 'Inbox',
  color: '#94a3b8',   // slate-400
  archived: false,
  created_at: '',
}

// ── Quick-add parsed result (from Claude API) ───────────────────────────────

export interface ParsedQuickAdd {
  title: string
  due_date: string | null         // ISO date
  estimated_minutes: number | null
  energy_required: EnergyLevel | null
  project_hint: string | null     // project name fragment, fuzzy-matched
  is_calendar_event: boolean      // "dentist appt 3pm Thursday" → true
}
