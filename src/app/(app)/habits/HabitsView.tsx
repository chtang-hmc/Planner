'use client'

import { useState, useEffect, useTransition } from 'react'
import { TimeIcon, StreakIcon, CalendarIcon } from '@/components/icons'
import { Task, Project, HabitStreak, INBOX_PROJECT } from '@/types'
import { completeTask, setHabitCompletion, syncScheduledHabits } from '@/app/actions/tasks'
import { rruleToLabel } from '@/lib/rrule-utils'
import AddTaskModal from '@/components/AddTaskModal'
import LogHabitModal from '@/components/LogHabitModal'
import TaskDetail from '@/components/TaskDetail'
import { daysSinceWeekStart, weekDayOrder } from '@/lib/week'
import { addDays, dayOfWeek, todayStr as todayIn } from '@/lib/day'

// ── Date helpers ──────────────────────────────────────────────────────────────

const DAY_LETTERS_BY_DOW = ['S','M','T','W','T','F','S']   // indexed by Date#getDay()
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/** Month of a day string, 0-11 — parsed as a pure date, no timezone in play. */
function monthOf(dayStr: string) {
  return parseInt(dayStr.slice(5, 7), 10) - 1
}

// ── Streak computation (from raw completion dates) ────────────────────────────

function computeStreak(dates: string[], today: string): { current: number; longest: number; total: number } {
  const unique = [...new Set(dates)].sort()
  if (unique.length === 0) return { current: 0, longest: 0, total: 0 }

  const yesterday = addDays(today, -1)
  const desc      = [...unique].reverse()

  // Current streak: consecutive days backwards from today or yesterday
  let current = 0
  if (desc[0] === today || desc[0] === yesterday) {
    let prev = desc[0]; current = 1
    for (let i = 1; i < desc.length; i++) {
      if (desc[i] === addDays(prev, -1)) { current++; prev = desc[i] } else break
    }
  }

  // Longest streak
  let longest = 0, run = 1
  for (let i = 1; i < unique.length; i++) {
    if (unique[i] === addDays(unique[i-1], 1)) { run++; longest = Math.max(longest, run) }
    else run = 1
  }
  longest = Math.max(longest, run, current)

  return { current, longest, total: unique.length }
}

// ── 16-week completion calendar ───────────────────────────────────────────────

function CompletionCalendar({ dates, today, weekStartDay, onToggle }: {
  dates: string[]
  /** Today in the user's timezone — the grid is built from day strings only. */
  today: string
  weekStartDay: number
  onToggle: (dateStr: string, done: boolean) => void
}) {
  const dateSet = new Set(dates)

  // Grid: 16 weeks, starting 15 weeks back on the user's first day of the week
  // so each column is one of their weeks, not a fixed Sunday-Saturday block.
  //
  // Stepped as day strings rather than Date objects: the old version built
  // local Dates and read them back as UTC, which shifted every cell by a day
  // for anyone west of the meridian.
  const startDate = addDays(today, -(15 * 7 + daysSinceWeekStart(dayOfWeek(today), weekStartDay)))
  const allDays   = Array.from({ length: 16 * 7 }, (_, i) => addDays(startDate, i))

  // Chunk into weeks (columns of 7)
  const weeks: string[][] = []
  for (let i = 0; i < allDays.length; i += 7) weeks.push(allDays.slice(i, i + 7))

  // Month labels: first col where month changes
  const monthMarkers: { col: number; label: string }[] = []
  let lastMonth = -1
  weeks.forEach((week, col) => {
    const m = monthOf(week[0])
    if (m !== lastMonth) { monthMarkers.push({ col, label: MONTH_NAMES[m] }); lastMonth = m }
  })

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="inline-flex flex-col gap-0 min-w-full">
        {/* Month row */}
        <div className="flex gap-px mb-1 ml-5">
          {weeks.map((_, col) => {
            const m = monthMarkers.find(x => x.col === col)
            return (
              <div key={col} className="w-3.5 shrink-0 text-[9px] text-slate-300 dark:text-slate-600">
                {m?.label ?? ''}
              </div>
            )
          })}
        </div>

        <div className="flex gap-px">
          {/* Day labels */}
          <div className="flex flex-col gap-px mr-1 w-4">
            {weekDayOrder(weekStartDay).map((dow, i) => (
              <div key={i} className={`h-3.5 text-[9px] flex items-center text-slate-300 dark:text-slate-600 ${i % 2 === 0 ? 'invisible' : ''}`}>
                {DAY_LETTERS_BY_DOW[dow]}
              </div>
            ))}
          </div>

          {/* Cells */}
          {weeks.map((week, col) => (
            <div key={col} className="flex flex-col gap-px">
              {week.map((ds, row) => {
                const done    = dateSet.has(ds)
                const future  = ds > today
                const isToday = ds === today
                return (
                  <button
                    key={row}
                    disabled={future}
                    onClick={() => onToggle(ds, !done)}
                    title={future ? ds : `${ds}${done ? ' ✓ — click to remove' : ' — click to log'}`}
                    className={`w-3.5 h-3.5 rounded-sm transition-colors ${
                      future    ? 'bg-slate-50 dark:bg-slate-900/30 cursor-default' :
                      done      ? 'bg-accent-500 dark:bg-accent-400 hover:opacity-70' :
                      isToday   ? 'ring-1 ring-accent-300 dark:ring-accent-700 bg-slate-100 dark:bg-slate-800 hover:bg-accent-200 dark:hover:bg-accent-800' :
                                  'bg-slate-100 dark:bg-slate-800 hover:bg-accent-200 dark:hover:bg-accent-800'
                    }`}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Individual habit card ─────────────────────────────────────────────────────

function HabitCard({
  habit,
  dates,
  today,
  doneToday,
  onDone,
  onOpen,
  pending,
  weeklyDone,
  weekStartDay,
  onToggleDate,
  onLogAtTime,
}: {
  habit: Task & { project: Project }
  dates: string[]
  today: string
  doneToday: boolean
  onDone: () => void
  onOpen: () => void
  pending: boolean
  weeklyDone: number
  weekStartDay: number
  onToggleDate: (dateStr: string, done: boolean) => void
  onLogAtTime: () => void
}) {
  const { current, longest, total } = computeStreak(dates, today)
  const freq = habit.rrule ? rruleToLabel(habit.rrule) : 'Anytime'
  const proj = habit.project ?? INBOX_PROJECT

  return (
    <div className={`bg-white dark:bg-slate-900 border rounded-2xl p-5 flex flex-col gap-4 transition-opacity ${
      doneToday
        ? 'border-accent-200 dark:border-accent-900 opacity-60'
        : 'border-slate-200 dark:border-slate-800'
    }`}>
      {/* Header row */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <button
            onClick={onOpen}
            className="text-left w-full group"
            title="Edit habit"
          >
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 leading-snug group-hover:text-accent-600 dark:group-hover:text-accent-400 transition-colors">
              {habit.title}
            </h3>
          </button>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span
              className="text-xs font-medium px-1.5 py-0.5 rounded"
              style={{ background: proj.color + '20', color: proj.color }}
            >
              {proj.name}
            </span>
            <span className="text-xs text-slate-400">
              {habit.rrule ? `↻ ${freq}` : '● Anytime'}
            </span>
            {habit.weekly_target && (
              <span className={`text-xs font-medium tabular-nums ${
                weeklyDone >= habit.weekly_target
                  ? 'text-emerald-500'
                  : 'text-violet-500 dark:text-violet-400'
              }`}>
                {weeklyDone}/{habit.weekly_target} this week
                {weeklyDone >= habit.weekly_target ? ' ✓' : ''}
              </span>
            )}
            {habit.estimated_minutes && (
              <span className="text-xs text-slate-400 font-mono">{habit.estimated_minutes}m</span>
            )}
          </div>
        </div>

        {/* Log at a time — for when the hour matters, or it happened earlier */}
        <button
          onClick={onLogAtTime}
          title="Log with a time, and optionally put it on your calendar"
          className="shrink-0 w-9 h-9 rounded-full border-2 border-slate-200 dark:border-slate-700 flex items-center justify-center text-sm text-slate-400 hover:border-violet-400 hover:text-violet-500 transition-colors"
        >
          <TimeIcon size={12} />
        </button>

        {/* Complete button */}
        <button
          onClick={onDone}
          disabled={doneToday || pending}
          title={doneToday ? 'Done for today' : 'Mark done now'}
          className={`shrink-0 w-9 h-9 rounded-full border-2 flex items-center justify-center text-sm font-bold transition-all ${
            doneToday
              ? 'bg-accent-500 border-accent-500 text-white cursor-default'
              : pending
                ? 'border-accent-300 dark:border-accent-700 text-accent-300 animate-pulse cursor-wait'
                : 'border-slate-300 dark:border-slate-600 text-slate-400 hover:border-accent-500 hover:text-accent-500 hover:bg-accent-50 dark:hover:bg-accent-950'
          }`}
        >
          {doneToday ? '✓' : pending ? '…' : '+'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: 'Streak', value: current, suffix: '', color: current >= 7 ? 'text-orange-500' : current >= 3 ? 'text-accent-500' : 'text-slate-700 dark:text-slate-300' },
          { label: 'Best',   value: longest, suffix: '', color: 'text-slate-500 dark:text-slate-400' },
          { label: 'Total',  value: total,   suffix: '', color: 'text-slate-500 dark:text-slate-400' },
        ].map(({ label, value, suffix, color }) => (
          <div key={label} className="py-2 bg-slate-50 dark:bg-slate-800 rounded-xl">
            <p className={`text-xl font-bold tabular-nums leading-none ${color}`}>
              {value}{suffix}
            </p>
            <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-wide">{label}</p>
          </div>
        ))}
      </div>

      {/* 16-week calendar */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Last 16 weeks</p>
          <p className="text-[10px] text-slate-300 dark:text-slate-600">click a day to log it</p>
        </div>
        <CompletionCalendar dates={dates} today={today} weekStartDay={weekStartDay} onToggle={onToggleDate} />
      </div>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

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

    // Optimistic: the two maps are mirrors, so always set both
    setLocalDates(done ? add : remove)
    setRemovedDates(done ? remove : add)

    startTransition(async () => {
      const res = await setHabitCompletion(habit.title, dateStr, done)
      if (res.error) {
        setLocalDates(done ? remove : add)      // roll back
        setRemovedDates(done ? add : remove)
        setToggleError(res.error)
        setTimeout(() => setToggleError(null), 4000)
      }
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
  const active   = habits.filter(h => !isDoneToday(h))
  const doneList = habits.filter(isDoneToday)

  const doneCountToday = doneList.length

  return (
    <>
      <div className="min-h-full bg-slate-50 dark:bg-slate-950">
        {/* Header */}
        <header className="sticky top-0 z-10 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur">
          <div className="px-6 py-3 flex items-center justify-between">
            <h1 className="font-semibold text-sm text-slate-900 dark:text-slate-100">Habits</h1>
            <div className="flex items-center gap-3">
              {habits.length > 0 && (
                <span className="text-xs text-slate-400 tabular-nums">
                  {doneCountToday} / {habits.length} today
                </span>
              )}
              <button
                onClick={() => setShowAdd(true)}
                className="text-xs bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-3 py-1.5 rounded-lg font-medium hover:opacity-80 transition-opacity"
              >
                + New habit
              </button>
            </div>
          </div>
        </header>

        {/* max-w-3xl with no mx-auto pinned everything to the left and left the
            rest of the panel empty. The cards were already a two-column grid,
            so they just need the room and one more column when there is width
            for it — a habit card holds a header, three stats and a 16-week
            heatmap, and stays readable down to about 380px. */}
        <div className="px-6 py-5">
          {habits.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
              <StreakIcon size={40} className="mx-auto text-slate-300 dark:text-slate-700" />
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">No habits yet</h2>
              <p className="text-sm text-slate-400 max-w-xs">
                Add habits you want to build — gym, reading, meditation — and track your streaks over time.
              </p>
              <button
                onClick={() => setShowAdd(true)}
                className="mt-2 px-5 py-2.5 bg-accent-500 hover:bg-accent-600 text-white rounded-xl text-sm font-semibold transition-colors"
              >
                Add your first habit
              </button>
            </div>
          ) : (
            <>
              {toggleError && (
                <p className="text-xs text-red-500 mb-3">{toggleError}</p>
              )}

              {autoLogged.length > 0 && (
                <div className="mb-4 flex items-start gap-3 px-3.5 py-2.5 rounded-xl border border-accent-200 dark:border-accent-900 bg-accent-50 dark:bg-accent-950/40">
                  <CalendarIcon size={14} className="shrink-0" />
                  <p className="text-xs text-slate-600 dark:text-slate-300 flex-1 leading-relaxed">
                    Filled in from your calendar:{' '}
                    <span className="font-medium">
                      {autoLogged.slice(0, 4).map(l => `${l.title} (${l.dateStr.slice(5)})`).join(', ')}
                      {autoLogged.length > 4 && ` +${autoLogged.length - 4} more`}
                    </span>
                    . Days that were blocked out and have since finished.
                  </p>
                  <button
                    onClick={undoAutoLogged}
                    className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 shrink-0 underline"
                  >
                    Undo
                  </button>
                </div>
              )}

              {/* Daily progress bar — a full-width 1px rule across a wide panel
                  reads as a divider, not a measure, so it keeps a sane width. */}
              <div className="mb-5 max-w-md">
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                  <span>Today</span>
                  <span className="font-mono text-slate-600 dark:text-slate-300">{doneCountToday}/{habits.length}</span>
                </div>
                <div className="h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent-500 rounded-full transition-all duration-500"
                    style={{ width: habits.length > 0 ? `${(doneCountToday / habits.length) * 100}%` : '0%' }}
                  />
                </div>
              </div>

              {/* Active habits (not done today) */}
              {active.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 mb-4 items-start">
                  {active.map(habit => (
                    <HabitCard
                      key={habit.id}
                      habit={habit}
                      dates={getDates(habit)}
                      today={todayStr}
                      doneToday={false}
                      onDone={() => handleDone(habit)}
                      onOpen={() => setDetailTask(habit)}
                      pending={pending.has(habit.id)}
                      weeklyDone={streaks[habit.id]?.completions_this_week ?? 0}
                      weekStartDay={weekStartDay}
                      onToggleDate={(d, v) => handleToggleDate(habit, d, v)}
                      onLogAtTime={() => setLogging(habit)}
                    />
                  ))}
                </div>
              )}

              {/* Done today — shown greyed at the bottom */}
              {doneList.length > 0 && (
                <>
                  {active.length > 0 && (
                    <p className="text-xs text-slate-400 uppercase tracking-wide font-medium mb-3 mt-2">Done today</p>
                  )}
                  <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
                    {doneList.map(habit => (
                      <HabitCard
                        key={habit.id}
                        habit={habit}
                        dates={getDates(habit)}
                        today={todayStr}
                        doneToday={true}
                        onDone={() => {}}
                        onOpen={() => setDetailTask(habit)}
                        pending={false}
                        weeklyDone={streaks[habit.id]?.completions_this_week ?? 0}
                        weekStartDay={weekStartDay}
                        onToggleDate={(d, v) => handleToggleDate(habit, d, v)}
                        onLogAtTime={() => setLogging(habit)}
                      />
                    ))}
                  </div>
                </>
              )}
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
