'use client'

/**
 * Chrome around the task list: the toolbar controls and the habit row.
 *
 * Extracted from TaskList so they can be rendered against fixtures at
 * /auth/design. A redesign you cannot look at is a redesign you are guessing
 * at, and this app cannot be opened in a browser without a session.
 */

import React from 'react'
import { Task, Project, HabitStreak } from '@/types'
import { rruleToLabel } from '@/lib/rrule-utils'

// ── Toolbar controls ─────────────────────────────────────────────────────────
//
// One idiom for every control in the toolbar. The filter row used to mix a
// segmented control, a bare <select> and toggle pills, each with its own
// height, radius and border — three ways of saying "this is a control".

/** Shared shell: same height, border and radius for every control. */
export const CONTROL =
  'h-7 text-xs rounded-lg border border-slate-200 dark:border-slate-700 '
  + 'bg-white dark:bg-slate-900 transition-colors focus:outline-none'

/** A group of mutually exclusive choices. */
export function Segmented({ value, onChange, options, hint }: {
  value: string
  onChange: (id: string) => void
  options: { id: string; label: string }[]
  /** Quiet label shown inside the group, for when the options alone are cryptic. */
  hint?: string
}) {
  return (
    <div className={`${CONTROL} inline-flex items-center gap-0.5 p-0.5`}>
      {hint && <span className="text-[10px] text-slate-400 px-1.5 select-none">{hint}</span>}
      {options.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-2.5 h-6 rounded-md font-medium transition-colors ${
            value === o.id
              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** An on/off filter. Accent means it is changing what you see. */
export function Toggle({ on, onClick, title, children }: {
  on: boolean
  onClick: () => void
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={`${CONTROL} px-2.5 font-medium ${
        on
          ? 'bg-accent-50 dark:bg-accent-950 border-accent-200 dark:border-accent-800 text-accent-700 dark:text-accent-300'
          : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}

// ── Habit row ────────────────────────────────────────────────────────────────

/**
 * A habit in the task list.
 *
 * Same language as the task rows: one surface with hairline dividers, words
 * instead of emoji, colour reserved for meaning — here, a met weekly target.
 * This was a violet-bordered card, which made habits look like a different app
 * bolted onto the list.
 */
export function HabitRow({ task, streak, pending, doneToday = false, onOpen, onDone, onLogTime }: {
  task: Task & { project: Project }
  streak?: HabitStreak | null
  pending: boolean
  /**
   * Already logged today. Filled circle, no second tap — the same state
   * `/habits` draws. Optional and false by default: the task list does not
   * know it, because completing a habit there removes the row.
   */
  doneToday?: boolean
  onOpen: () => void
  onDone: (e: React.MouseEvent) => void
  onLogTime: (e: React.MouseEvent) => void
}) {
  const target = task.weekly_target
  const done   = streak?.completions_this_week ?? 0
  const met    = !!target && done >= target

  return (
    <div
      onClick={onOpen}
      className="group flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
    >
      <button
        onClick={onDone}
        disabled={pending || doneToday}
        title={doneToday ? 'Done for today' : 'Log for today'}
        aria-label={doneToday ? `${task.title} is done for today` : `Log ${task.title} for today`}
        className={`w-4 h-4 rounded-full border-2 shrink-0 transition-colors flex items-center justify-center ${
          doneToday
            ? 'bg-accent-500 border-accent-500 cursor-default'
            : pending
              ? 'border-accent-400 bg-accent-100 dark:bg-accent-900 animate-pulse'
              : 'border-slate-300 dark:border-slate-600 hover:border-accent-500 hover:bg-accent-50 dark:hover:bg-accent-950'
        }`}
      >
        {doneToday && <span className="text-white text-[8px] leading-none font-bold">✓</span>}
      </button>

      <div className="min-w-0 flex-1">
        <span className="text-[13px] font-medium text-slate-800 dark:text-slate-100">{task.title}</span>
        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-400">
          {target ? (
            <>
              <span className="flex gap-0.5">
                {Array.from({ length: target }, (_, i) => (
                  <span
                    key={i}
                    className={`inline-block w-1.5 h-1.5 rounded-full ${
                      i < done
                        ? met ? 'bg-accent-500' : 'bg-slate-400 dark:bg-slate-500'
                        : 'bg-slate-200 dark:bg-slate-700'
                    }`}
                  />
                ))}
              </span>
              <span className={`tabular-nums ${met ? 'text-accent-600 dark:text-accent-400 font-medium' : ''}`}>
                {done}/{target} this week
              </span>
            </>
          ) : task.rrule ? (
            <span>{rruleToLabel(task.rrule)}</span>
          ) : (
            <span>Anytime</span>
          )}
          {streak && streak.current_streak > 0 && (
            <>
              <span>·</span>
              <span className="tabular-nums">
                {streak.current_streak} day{streak.current_streak === 1 ? '' : 's'} running
              </span>
            </>
          )}
        </div>
      </div>

      <button
        onClick={onLogTime}
        title="Log with a time, and optionally put it on your calendar"
        className="shrink-0 text-[11px] font-medium px-2 h-6 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-accent-600 dark:hover:text-accent-400 hover:border-accent-400 transition-all"
      >
        Log time
      </button>
    </div>
  )
}

/**
 * Container for a run of habit rows — matches the Rail task surface.
 *
 * `className` carries the section's own spacing. It defaults to the gap the
 * task list wants below the list above it; a parent that already spaces its
 * children (Home's column) passes an empty string rather than getting both.
 */
export function HabitList({ count, children, className = 'mt-8' }: {
  count: number
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <div className="flex items-baseline gap-3 mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Habits</h2>
        <span className="text-xs text-slate-400 tabular-nums">{count}</span>
        <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800" />
      </div>
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
        {children}
      </div>
    </div>
  )
}
