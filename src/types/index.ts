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
  urgency_score: number              // 0–100, recomputed nightly
  urgency_curve: UrgencyCurve
  rrule: string | null               // iCal RRULE string for recurring tasks
  weekly_target: number | null       // habits only: how many times per week to aim for
  exclusive_group: string | null     // habits only: habits sharing a group are never scheduled on the same day
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

export function computeUrgency(task: Pick<Task, 'priority' | 'urgency_curve' | 'due_date' | 'created_at'>): number {
  const priorityPts = task.priority * 10  // 10 | 20 | 30 | 40

  if (!task.due_date) return Math.min(priorityPts, 100)

  const total   = new Date(task.due_date).getTime() - new Date(task.created_at).getTime()
  const elapsed = Date.now() - new Date(task.created_at).getTime()
  const r       = Math.min(elapsed / total, 1)  // 0–1, capped at 1 past deadline

  let pressure: number

  switch (task.urgency_curve) {
    case 'linear':
      pressure = r * 60
      break
    case 'exponential':
      // Sigmoid centered at 80% elapsed — calm until final stretch, then spikes
      pressure = 60 / (1 + Math.exp(-10 * (r - 0.8)))
      break
    case 'step':
      pressure = r > 0.85 ? 60 : r > 0.6 ? 25 : 5
      break
  }

  return Math.min(priorityPts + pressure, 100)
}

export interface UrgencyBreakdown {
  score: number
  priorityPts: number   // 10–40
  timePressure: number  // 0–60; 0 when no due date
  elapsed: number       // 0–1 ratio through the task lifespan (null when no due date)
  hasDueDate: boolean
}

/** Same math as computeUrgency, but returns each component for display. */
export function computeUrgencyBreakdown(
  task: Pick<Task, 'priority' | 'urgency_curve' | 'due_date' | 'created_at'>
): UrgencyBreakdown {
  const priorityPts = task.priority * 10

  if (!task.due_date) {
    return { score: Math.min(priorityPts, 100), priorityPts, timePressure: 0, elapsed: 0, hasDueDate: false }
  }

  const total    = new Date(task.due_date).getTime() - new Date(task.created_at).getTime()
  const elapsedMs = Date.now() - new Date(task.created_at).getTime()
  const r         = Math.min(elapsedMs / total, 1)

  let pressure: number
  switch (task.urgency_curve) {
    case 'linear':
      pressure = r * 60
      break
    case 'exponential':
      pressure = 60 / (1 + Math.exp(-10 * (r - 0.8)))
      break
    case 'step':
      pressure = r > 0.85 ? 60 : r > 0.6 ? 25 : 5
      break
  }

  const score = Math.min(priorityPts + pressure, 100)
  return { score, priorityPts, timePressure: pressure, elapsed: r, hasDueDate: true }
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
