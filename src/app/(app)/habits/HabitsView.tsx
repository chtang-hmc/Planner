'use client'

/**
 * Habits, as a list.
 *
 * Five habits in the space one card used. Each card carried a header, three
 * tiles holding the same number on four of five habits, and a 16-week heatmap
 * — 448 squares to represent twelve piano sessions. The row keeps what is
 * acted on; the heatmap shrinks to four weeks of dots, and its useful part
 * comes back below as a week of squares you can actually click.
 */

import { useState, useEffect, useTransition } from 'react'
import { CalendarIcon } from '@/components/icons'
import { Task, Project, HabitStreak } from '@/types'
import { completeTask, setHabitCompletion, syncScheduledHabits } from '@/app/actions/tasks'
import AddTaskModal from '@/components/AddTaskModal'
import LogHabitModal from '@/components/LogHabitModal'
import TaskDetail from '@/components/TaskDetail'
import { HabitRow, HabitTableHeader, type HabitRowModel } from '@/components/ds/HabitRow'
import { HabitWeekGrid } from '@/components/ds/HabitWeekGrid'
import {
  cadence, weekProgress, habitStreak, habitsHeadline,
} from '@/lib/habit-stats'
import { formatTimeOfDay } from '@/lib/task-format'
import { weekStartOfDay } from '@/lib/week'
import { todayStr as todayIn, localDayStr } from '@/lib/day'

interface Props {
  habits:           (Task & { project: Project })[]
  completionMap:    Record<string, string[]>
  doneToday:        string[]   // habit ids already done today
  projects:         Project[]
  streaks:          Record<string, HabitStreak>
  gcalWriteEnabled: boolean
  weekStartDay:     number
  /** The user's timezone, so the page and the server agree on what "today" is. */
  tz:               string
}

const clock = (minutes: number | null) =>
  minutes == null ? null : formatTimeOfDay(minutes).toLowerCase().replace(' ', '')

export default function HabitsView({
  habits, completionMap, doneToday: serverDoneToday, projects, streaks, gcalWriteEnabled, weekStartDay, tz,
}: Props) {
  // Track which habits got completed this session (optimistic)
  const [sessionDone, setSessionDone] = useState<Set<string>>(new Set(serverDoneToday))
  const [pending,     setPending]     = useState<Set<string>>(new Set())
  const [localDates,  setLocalDates]  = useState<Record<string, string[]>>({})
  // Dates un-logged this session, subtracted in getDates
  const [removedDates, setRemovedDates] = useState<Record<string, string[]>>({})
  const [toggleError, setToggleError]   = useState<string | null>(null)
  /* `title|day` keys being written from the week grid, so one square can be
     disabled without freezing the other thirty-four. */
  const [gridPending, setGridPending]   = useState<Set<string>>(new Set())
  const [showAdd,     setShowAdd]     = useState(false)
  const [detailTask,  setDetailTask]  = useState<(Task & { project: Project }) | null>(null)
  // Habit whose "log at a time" sheet is open
  const [logging,     setLogging]     = useState<(Task & { project: Project }) | null>(null)
  // Sessions filled in from the calendar on this visit, shown so an automatic
  // write is never a silent one.
  const [autoLogged,  setAutoLogged]  = useState<{ title: string; dateStr: string }[]>([])
  const [, startTransition]          = useTransition()

  const todayStr = todayIn(tz)

  function getDates(habit: Task) {
    const base  = completionMap[habit.title] ?? []
    const extra = localDates[habit.title] ?? []
    const gone  = new Set(removedDates[habit.title] ?? [])
    return [...new Set([...base, ...extra])].filter(d => !gone.has(d))
  }

  /**
   * Fill in habits that were on the calendar on days that have since finished.
   *
   * Runs once per visit rather than on a schedule: there's no worker, and the
   * habits page is where the result is visible anyway. It writes nothing for a
   * day that's already logged, so re-running is free.
   */
  useEffect(() => {
    let live = true
    syncScheduledHabits()
      .then(res => {
        if (!live || res.logged.length === 0) return
        setAutoLogged(res.logged)
        setLocalDates(prev => {
          const next = { ...prev }
          for (const l of res.logged) next[l.title] = [...(next[l.title] ?? []), l.dateStr]
          return next
        })
      })
      .catch(() => {})   // nothing the user did; the page is still correct
    return () => { live = false }
  }, [])

  /** Undo the whole auto-logged batch — one click, since it was one action. */
  function undoAutoLogged() {
    const batch = autoLogged
    setAutoLogged([])
    setLocalDates(prev => {
      const next = { ...prev }
      for (const l of batch) next[l.title] = (next[l.title] ?? []).filter(d => d !== l.dateStr)
      return next
    })
    setRemovedDates(prev => {
      const next = { ...prev }
      for (const l of batch) next[l.title] = [...(next[l.title] ?? []), l.dateStr]
      return next
    })
    startTransition(async () => {
      for (const l of batch) await setHabitCompletion(l.title, l.dateStr, false)
    })
  }

  /**
   * Log or un-log a habit on a past day, from the heatmap. Writes a completed
   * occurrence rather than touching the pending row, so today's card stays
   * actionable and the spawn chain is untouched.
   */
  function handleToggleDate(habit: Task & { project: Project }, dateStr: string, done: boolean) {
    const add    = (m: Record<string, string[]>) => ({ ...m, [habit.title]: [...(m[habit.title] ?? []), dateStr] })
    const remove = (m: Record<string, string[]>) => ({ ...m, [habit.title]: (m[habit.title] ?? []).filter(d => d !== dateStr) })
    const key = `${habit.title}|${dateStr}`

    // Optimistic: the two maps are mirrors, so always set both
    setLocalDates(done ? add : remove)
    setRemovedDates(done ? remove : add)
    setGridPending(p => new Set([...p, key]))

    /* Un-logging today also has to move the row out of "done": `sessionDone`
       is keyed by id and nothing else clears it, so without this the tick
       stayed filled while the day's dot vanished. */
    if (!done && dateStr === todayStr) {
      setSessionDone(p => { const n = new Set(p); n.delete(habit.id); return n })
    }

    startTransition(async () => {
      const res = await setHabitCompletion(habit.title, dateStr, done)
      if (res.error) {
        setLocalDates(done ? remove : add)      // roll back
        setRemovedDates(done ? add : remove)
        if (!done && dateStr === todayStr) setSessionDone(p => new Set([...p, habit.id]))
        setToggleError(res.error)
        setTimeout(() => setToggleError(null), 4000)
      }
      setGridPending(p => { const n = new Set(p); n.delete(key); return n })
    })
  }

  function handleDone(habit: Task & { project: Project }) {
    if (pending.has(habit.id) || isDoneToday(habit)) return
    setPending(prev => new Set([...prev, habit.id]))
    // Optimistically add today to dates and mark done
    setLocalDates(prev => ({
      ...prev,
      [habit.title]: [...(prev[habit.title] ?? []), todayStr],
    }))
    startTransition(async () => {
      try {
        await completeTask(habit.id, null, null, null)
        setSessionDone(prev => new Set([...prev, habit.id]))
      } finally {
        setPending(prev => { const n = new Set(prev); n.delete(habit.id); return n })
      }
    })
  }

  // Split: pending/done-today (greyed) vs active (need to do).
  //
  // A completion recorded for today counts however it got there — the "+", the
  // heatmap, or the log sheet. Keying only on `sessionDone` left a habit already
  // logged today sitting in the active list with a live "+", which would record
  // it a second time.
  const isDoneToday = (h: Task) => sessionDone.has(h.id) || getDates(h).includes(todayStr)
  const doneCountToday = habits.filter(isDoneToday).length

  const weekStartStr = weekStartOfDay(todayStr, weekStartDay)

  /** Habits with a calendar block on today that have not been logged. */
  const scheduledToday = habits
    .filter(h => h.scheduled_start
      && localDayStr(h.scheduled_start, tz) === todayStr
      && !isDoneToday(h))
    .map(h => h.title)

  function toRowModel(habit: Task & { project: Project }): HabitRowModel {
    const days = getDates(habit)
    return {
      id:      habit.id,
      title:   habit.title,
      cadence: cadence(habit.weekly_target),
      minutes: habit.adjusted_minutes ?? habit.estimated_minutes,
      /* `7pm`, not `7 PM`: this sits in a run of dot-separated meta where the
         space reads as another separator. Same shape the calendar block uses. */
      timeLabel: clock(
        habit.due_time_minutes != null ? habit.due_time_minutes
        : habit.scheduled_start && localDayStr(habit.scheduled_start, tz) === todayStr
          ? new Date(habit.scheduled_start).getHours() * 60
            + new Date(habit.scheduled_start).getMinutes()
        : null),
      days,
      week:   weekProgress({ weeklyTarget: habit.weekly_target, days, weekStartStr }),
      /* Computed here, not read from `habit_streaks`. That table is keyed by
         task_id and a habit is a family of rows: on 2026-09-21 every row in it
         said `current_streak: 1`, including Piano's, which had run 14 days. */
      streak: habitStreak({
        weeklyTarget: habit.weekly_target, days, todayStr, weekStartDay,
      }),
      doneToday: isDoneToday(habit),
      pending:   pending.has(habit.id),
    }
  }

  /* One list, in a stable order. The old page moved a habit to a "done today"
     section the moment you logged it, so the row you had just aimed at jumped
     somewhere else — and the ordering of the page changed all day. */
  const rows = [...habits].sort((a, b) => a.title.localeCompare(b.title))

  return (
    <>
      <div className="min-h-full bg-surface-sunk">
        <header className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur">
          <div className="px-6 py-3 flex items-baseline justify-between gap-4 flex-wrap">
            <div>
              <h1 className="display text-display-m text-ink leading-tight">Habits</h1>
              <p className="text-meta text-ink-muted mt-0.5">
                {habitsHeadline({
                  total: habits.length, doneToday: doneCountToday, scheduled: scheduledToday,
                })}
              </p>
            </div>
            <button
              onClick={() => setShowAdd(true)}
              className="h-9 px-4 rounded-ctrl bg-accent-600 text-white text-[13px] font-semibold hover:bg-accent-700 transition-colors"
            >
              New habit
            </button>
          </div>
        </header>

        <div className="px-6 py-4 flex flex-col gap-4">
          {habits.length === 0 ? (
            <div className="rounded-xl border border-line bg-surface py-16 text-center flex flex-col items-center gap-3">
              <h2 className="text-meta font-semibold text-ink">No habits yet</h2>
              <p className="text-micro text-ink-muted max-w-xs">
                Add the things you want to do regularly — gym, reading, practice — and the
                page will keep the count.
              </p>
              <button onClick={() => setShowAdd(true)}
                      className="text-meta font-medium text-accent-600 hover:underline underline-offset-2">
                Add your first habit →
              </button>
            </div>
          ) : (
            <>
              {toggleError && <p className="text-small text-danger">{toggleError}</p>}

              {autoLogged.length > 0 && (
                <div className="flex items-start gap-3 px-3.5 py-2.5 rounded-xl border border-accent-200"
                     style={{ background: 'var(--accent-tint)' }}>
                  <CalendarIcon size={14} className="shrink-0" />
                  <p className="text-micro text-ink-2 flex-1 leading-relaxed">
                    Filled in from your calendar:{' '}
                    <span className="font-medium">
                      {autoLogged.slice(0, 4).map(l => `${l.title} (${l.dateStr.slice(5)})`).join(', ')}
                      {autoLogged.length > 4 && ` +${autoLogged.length - 4} more`}
                    </span>
                    . Days that were blocked out and have since finished.
                  </p>
                  <button onClick={undoAutoLogged}
                          className="text-micro font-medium text-ink-muted hover:text-ink-2 shrink-0 underline underline-offset-2">
                    Undo
                  </button>
                </div>
              )}

              <div className="rounded-xl border border-line bg-surface overflow-hidden">
                <HabitTableHeader />
                <div className="border-t border-line-soft divide-y divide-line-soft">
                  {rows.map(h => (
                    <HabitRow
                      key={h.id}
                      habit={toRowModel(h)}
                      todayStr={todayStr}
                      onLog={() => isDoneToday(h)
                        ? handleToggleDate(h, todayStr, false)
                        : handleDone(h)}
                      onOpen={() => setDetailTask(h)}
                    />
                  ))}
                </div>
              </div>

              <HabitWeekGrid
                rows={rows.map(h => ({ id: h.id, title: h.title, days: getDates(h) }))}
                weekStartStr={weekStartStr}
                todayStr={todayStr}
                pending={gridPending}
                onToggle={(title, day, next) => {
                  const habit = habits.find(h => h.title === title)
                  if (habit) handleToggleDate(habit, day, next)
                }}
              />
            </>
          )}
        </div>
      </div>

      {logging && (
        <LogHabitModal
          habit={logging}
          gcalWriteEnabled={gcalWriteEnabled}
          onClose={() => setLogging(null)}
          onLogged={dateStr => {
            const habit = logging
            setLocalDates(prev => ({
              ...prev,
              [habit.title]: [...(prev[habit.title] ?? []), dateStr],
            }))
            setRemovedDates(prev => ({
              ...prev,
              [habit.title]: (prev[habit.title] ?? []).filter(d => d !== dateStr),
            }))
            // Logging today closes out the pending row server-side, so the card
            // has to move to "done today" with it.
            if (dateStr === todayStr) setSessionDone(prev => new Set([...prev, habit.id]))
            setLogging(null)
          }}
        />
      )}

      {showAdd && (
        <AddTaskModal
          projects={projects}
          defaultType="habit"
          onClose={() => setShowAdd(false)}
          onCreated={() => setShowAdd(false)}
        />
      )}

      {detailTask && (
        <TaskDetail
          task={detailTask}
          projects={projects}
          streak={streaks[detailTask.id] ?? null}
          gcalWriteEnabled={gcalWriteEnabled}
          onClose={() => setDetailTask(null)}
        />
      )}
    </>
  )
}
