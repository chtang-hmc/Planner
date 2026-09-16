'use client'

import { useState, useTransition } from 'react'
import { Task, Project, HabitStreak, INBOX_PROJECT } from '@/types'
import { completeTask, setHabitCompletion } from '@/app/actions/tasks'
import { rruleToLabel } from '@/lib/rrule-utils'
import AddTaskModal from '@/components/AddTaskModal'
import LogHabitModal from '@/components/LogHabitModal'
import TaskDetail from '@/components/TaskDetail'
import { daysSinceWeekStart, weekDayOrder } from '@/lib/week'

// ── Date helpers ──────────────────────────────────────────────────────────────

const DAY_LETTERS_BY_DOW = ['S','M','T','W','T','F','S']   // indexed by Date#getDay()
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10)
}
function addDays(d: Date, n: number) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r
}

// ── Streak computation (from raw completion dates) ────────────────────────────

function computeStreak(dates: string[]): { current: number; longest: number; total: number } {
  const unique = [...new Set(dates)].sort()
  if (unique.length === 0) return { current: 0, longest: 0, total: 0 }

  const todayStr     = toDateStr(new Date())
  const yesterdayStr = toDateStr(addDays(new Date(), -1))
  const desc         = [...unique].reverse()

  // Current streak: consecutive days backwards from today or yesterday
  let current = 0
  if (desc[0] === todayStr || desc[0] === yesterdayStr) {
    let prev = desc[0]; current = 1
    for (let i = 1; i < desc.length; i++) {
      const expected = toDateStr(addDays(new Date(prev + 'T12:00:00'), -1))
      if (desc[i] === expected) { current++; prev = desc[i] } else break
    }
  }

  // Longest streak
  let longest = 0, run = 1
  for (let i = 1; i < unique.length; i++) {
    const expected = toDateStr(addDays(new Date(unique[i-1] + 'T12:00:00'), 1))
    if (unique[i] === expected) { run++; longest = Math.max(longest, run) }
    else run = 1
  }
  longest = Math.max(longest, run, current)

  return { current, longest, total: unique.length }
}

// ── 16-week completion calendar ───────────────────────────────────────────────

function CompletionCalendar({ dates, weekStartDay, onToggle }: {
  dates: string[]
  weekStartDay: number
  onToggle: (dateStr: string, done: boolean) => void
}) {
  const dateSet = new Set(dates)
  const today   = new Date(); today.setHours(0, 0, 0, 0)

  // Grid: 16 weeks, starting 15 weeks back on the user's first day of the week
  // so each column is one of their weeks, not a fixed Sunday-Saturday block.
  const startDate = addDays(today, -(15 * 7 + daysSinceWeekStart(today.getDay(), weekStartDay)))
  const totalDays = 16 * 7
  const allDays   = Array.from({ length: totalDays }, (_, i) => addDays(startDate, i))

  // Chunk into weeks (columns of 7)
  const weeks: Date[][] = []
  for (let i = 0; i < allDays.length; i += 7) weeks.push(allDays.slice(i, i + 7))

  // Month labels: first col where month changes
  const monthMarkers: { col: number; label: string }[] = []
  let lastMonth = -1
  weeks.forEach((week, col) => {
    const m = week[0].getMonth()
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
              {week.map((day, row) => {
                const ds     = toDateStr(day)
                const done   = dateSet.has(ds)
                const future = day > today
                const isToday = ds === toDateStr(today)
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
  doneToday: boolean
  onDone: () => void
  onOpen: () => void
  pending: boolean
  weeklyDone: number
  weekStartDay: number
  onToggleDate: (dateStr: string, done: boolean) => void
  onLogAtTime: () => void
}) {
  const { current, longest, total } = computeStreak(dates)
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
          🕐
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
          { label: 'Streak', value: current, suffix: current >= 7 ? '🔥' : '', color: current >= 7 ? 'text-orange-500' : current >= 3 ? 'text-accent-500' : 'text-slate-700 dark:text-slate-300' },
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
        <CompletionCalendar dates={dates} weekStartDay={weekStartDay} onToggle={onToggleDate} />
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
}

export default function HabitsView({
  habits, completionMap, doneToday: serverDoneToday, projects, streaks, gcalWriteEnabled, weekStartDay,
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
  const [, startTransition]          = useTransition()

  const todayStr = toDateStr(new Date())

  function getDates(habit: Task) {
    const base  = completionMap[habit.title] ?? []
    const extra = localDates[habit.title] ?? []
    const gone  = new Set(removedDates[habit.title] ?? [])
    return [...new Set([...base, ...extra])].filter(d => !gone.has(d))
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

        <div className="px-6 py-5 max-w-3xl">
          {habits.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
              <div className="text-5xl">🌱</div>
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

              {/* Daily progress bar */}
              <div className="mb-5">
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
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                  {active.map(habit => (
                    <HabitCard
                      key={habit.id}
                      habit={habit}
                      dates={getDates(habit)}
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
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {doneList.map(habit => (
                      <HabitCard
                        key={habit.id}
                        habit={habit}
                        dates={getDates(habit)}
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
