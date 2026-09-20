'use client'

/**
 * Home — the page you land on.
 *
 * Everything on it is either something to act on or the context needed to
 * choose. The thinking is in `src/lib/home.ts`; this file decides how it reads
 * and what happens when you click it.
 */

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Task, Project, HabitStreak, INBOX_PROJECT } from '@/types'
import { useTimer } from '@/contexts/TimerContext'
import {
  CalendarIcon, FocusIcon, OverdueIcon, TimeIcon, WarningIcon,
} from '@/components/icons'
import { HabitRow, HabitList, CONTROL } from '@/components/TaskChrome'
import MicroReflection from '@/components/MicroReflection'
import TaskDetail from '@/components/TaskDetail'
import LogHabitModal from '@/components/LogHabitModal'
import SchedulePreviewModal, { type PreviewBlock } from '@/components/SchedulePreviewModal'
import { completeTask } from '@/app/actions/tasks'
import { triggerCalendarSync } from '@/app/actions/calendar'
import { proposeSchedule, type ExistingItem } from '@/app/actions/scheduling'
import type { SchedulerTask } from '@/lib/scheduler'
import { formatClock, formatGapMinutes, type AttentionRow, type HomeData, type Suggestion } from '@/lib/home'

type TaskRow = Task & { project: Project }

interface Props {
  data:              HomeData
  dayStr:            string
  tz:                string
  allDayEvents:      { id: string; title: string }[]
  tasks:             TaskRow[]
  habits:            TaskRow[]
  /** Ids among `habits` already logged today — drawn ticked, not hidden. */
  habitsDoneToday:   string[]
  streaks:           Record<string, HabitStreak>
  projects:          Project[]
  gcalWriteEnabled:  boolean
  calendarConnected: boolean
  /**
   * How long ago the calendar was pulled, already worded — "2h ago", or null
   * when nothing has recorded a sync.
   *
   * A string rather than the timestamp because this is a *duration*, and a
   * duration measured during render is measured twice: once on the server and
   * once when the browser hydrates, a moment later. A sync 1m55s old crosses
   * the "just now" boundary in between, the two renders disagree, and React
   * throws the tree away. The server measures it once and the client is told
   * the answer.
   *
   * The cost is that it stops being true while the page sits open. That is
   * acceptable here: every other number on this page is a snapshot from the
   * same instant, and a hidden tab re-fetches when it comes back.
   */
  syncAge:           string | null
}

export default function HomeView({
  data, dayStr, tz, allDayEvents, tasks, habits, habitsDoneToday, streaks, projects,
  gcalWriteEnabled, calendarConnected, syncAge,
}: Props) {
  const router = useRouter()
  const timer = useTimer()
  const [, startTransition] = useTransition()

  const [completing, setCompleting]     = useState<TaskRow | null>(null)
  const [detail, setDetail]             = useState<TaskRow | null>(null)
  const [loggingHabit, setLoggingHabit] = useState<TaskRow | null>(null)
  const [doneIds, setDoneIds]           = useState<Set<string>>(new Set())
  const [pendingHabits, setPendingHabits] = useState<Set<string>>(new Set())
  const [syncing, setSyncing]           = useState(false)
  const [planning, setPlanning]         = useState(false)
  const [preview, setPreview] = useState<
    { loading?: boolean; blocks: PreviewBlock[]; unschedulable: SchedulerTask[]; existing: ExistingItem[] } | null
  >(null)

  /**
   * Everything on this page is measured from the instant the server rendered
   * it — "1h 30m free until 2:45" is only true for as long as the tab is
   * looked at. Coming back to a tab left open over lunch should not show
   * lunchtime's answer, so a hidden tab re-fetches when it returns.
   *
   * Five minutes because that is roughly when a gap's remaining time stops
   * rounding to the same number; below it the refresh would be noise.
   */
  const hiddenAt = useRef<number | null>(null)
  useEffect(() => {
    const STALE_MS = 5 * 60_000
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { hiddenAt.current = Date.now(); return }
      if (hiddenAt.current && Date.now() - hiddenAt.current > STALE_MS) router.refresh()
      hiddenAt.current = null
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [router])

  const byId = new Map(tasks.map(t => [t.id, t]))
  const clock = (ms: number) => formatClock(ms, tz)

  // 'en-US' rather than the runtime's locale. `undefined` resolves to Node's
  // default on the server and the browser's on the client, so an en-GB reader
  // got "Sunday, 20 September" hydrated over "Sunday, September 20" — a
  // mismatch on the largest text on the page. formatClock pins its locale for
  // the same reason; noon UTC and timeZone UTC keep the day from shifting.
  const heading = new Date(dayStr + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  })

  // ── Actions ────────────────────────────────────────────────────────────────

  function openTask(id: string) {
    const t = byId.get(id)
    if (t) setDetail({ ...t, project: t.project ?? INBOX_PROJECT })
  }

  function startWork(id: string) {
    const t = byId.get(id)
    if (t) timer.start({ ...t, project: t.project ?? INBOX_PROJECT })
  }

  function markDone(id: string) {
    const t = byId.get(id)
    if (t) setCompleting({ ...t, project: t.project ?? INBOX_PROJECT })
  }

  async function logHabit(task: TaskRow) {
    if (pendingHabits.has(task.id)) return
    setPendingHabits(prev => new Set([...prev, task.id]))
    try {
      await completeTask(task.id, null, null, null)
      setDoneIds(prev => new Set([...prev, task.id]))
      router.refresh()
    } finally {
      setPendingHabits(prev => { const n = new Set(prev); n.delete(task.id); return n })
    }
  }

  function refreshCalendar() {
    setSyncing(true)
    startTransition(async () => {
      try { await triggerCalendarSync(); router.refresh() }
      catch (err) { console.error('calendar sync failed', err) }
      finally { setSyncing(false) }
    })
  }

  /**
   * Put today's work on the calendar.
   *
   * The only thing on this page that calls Google, and it is behind a click —
   * which is the whole point of the split. It can take its time.
   */
  function blockToday() {
    if (!gcalWriteEnabled) return
    setPlanning(true)
    setPreview({ loading: true, blocks: [], unschedulable: [], existing: [] })
    startTransition(async () => {
      try {
        const res = await proposeSchedule(1, tz, dayStr)
        setPreview({
          blocks: res.scheduled.map(b => ({
            taskId: b.taskId, taskTitle: b.taskTitle, taskPriority: b.taskPriority,
            startISO: b.startISO, endISO: b.endISO,
            segmentIndex: b.segmentIndex, totalSegments: b.totalSegments,
            energyMatch: b.energyMatch,
          })),
          unschedulable: res.unschedulable,
          existing: res.existing,
        })
      } catch (err) {
        console.error('proposeSchedule failed', err)
        setPreview(null)
      } finally {
        setPlanning(false)
      }
    })
  }

  // ── Right now ──────────────────────────────────────────────────────────────

  const { rightNow } = data
  const rightNowText = (() => {
    const { inEvent, gap, nextEvent, doneForToday } = rightNow
    if (inEvent) {
      return gap
        ? `In ${inEvent.title} until ${clock(inEvent.endMs)}. Next free: ${formatGapMinutes(gap.minutes)} at ${clock(gap.startMs)}.`
        : `In ${inEvent.title} until ${clock(inEvent.endMs)}. Nothing free after it today.`
    }
    if (doneForToday) return 'No working time left today.'
    if (gap && nextEvent) {
      return `${formatGapMinutes(gap.minutes)} free until ${nextEvent.title} at ${clock(nextEvent.startMs)}.`
    }
    if (gap) return `${formatGapMinutes(gap.minutes)} free until ${clock(gap.endMs)}.`
    return 'Nothing on today.'
  })()


  /**
   * Today's habits stay on the page once logged, ticked rather than removed.
   * Dropping them made the section empty by the evening, which reads as "no
   * habits today" — the opposite of what a finished day should look like.
   * `habitsDoneToday` is the server's answer; `doneIds` covers taps since load.
   */
  const habitDone = (id: string) => doneIds.has(id) || habitsDoneToday.includes(id)

  return (
    <>
      <div className="min-h-full flex flex-col bg-slate-50 dark:bg-slate-950">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-10 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur">
          <div className="px-6 pt-4 pb-3 flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                {heading}
              </h1>
              {/* Section 1 — one sentence, and the reason the page exists. */}
              <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">{rightNowText}</p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {calendarConnected && (
                <button
                  onClick={refreshCalendar}
                  disabled={syncing}
                  title="Pull the calendar from Google again"
                  className={`${CONTROL} px-2.5 font-medium text-slate-500 hover:border-accent-400 hover:text-accent-600 dark:hover:text-accent-400 disabled:opacity-40`}
                >
                  {syncing ? 'Syncing…' : syncAge ? `Synced ${syncAge} · refresh` : 'Refresh calendar'}
                </button>
              )}
              {gcalWriteEnabled && (
                <button
                  onClick={blockToday}
                  disabled={planning}
                  title="Propose blocks for today's work and write them to your calendar"
                  className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium px-3.5 h-7 rounded-lg hover:opacity-80 disabled:opacity-40 transition-opacity"
                >
                  {planning ? 'Planning…' : 'Block today'}
                </button>
              )}
            </div>
          </div>

          {allDayEvents.length > 0 && (
            <div className="px-6 pb-2.5 flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">All day</span>
              {allDayEvents.map(e => (
                <span key={e.id} className="text-[11px] text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800">
                  {e.title}
                </span>
              ))}
            </div>
          )}
        </header>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex-1 px-6 py-5 grid gap-5 lg:grid-cols-5 auto-rows-min">

          {/* Left: everything you act on, in the order you act on it. */}
          <div className="lg:col-span-3 flex flex-col gap-5 min-w-0">
            <DoThisNow
              suggestions={data.suggestions}
              onOpen={openTask}
              onStart={startWork}
              onDone={markDone}
              timerBusy={timer.phase !== 'idle'}
            />

            <NeedsAttention
              overdue={data.overdue}
              dueToday={data.dueToday}
              doneIds={doneIds}
              onOpen={openTask}
              onDone={markDone}
            />

            {habits.length > 0 && (
              <HabitList count={habits.filter(h => !habitDone(h.id)).length} className="">
                {habits.map(h => (
                  <HabitRow
                    key={h.id}
                    task={h}
                    streak={streaks[h.id] ?? null}
                    pending={pendingHabits.has(h.id)}
                    doneToday={habitDone(h.id)}
                    onOpen={() => setDetail({ ...h, project: h.project ?? INBOX_PROJECT })}
                    onDone={e => { e.stopPropagation(); void logHabit(h) }}
                    onLogTime={e => { e.stopPropagation(); setLoggingHabit(h) }}
                  />
                ))}
              </HabitList>
            )}
          </div>

          {/* Right: the day itself — the context for every choice on the left. */}
          <div className="lg:col-span-2 flex flex-col gap-5 min-w-0">
            <TodaysShape data={data} clock={clock} onOpen={openTask} />
          </div>
        </div>
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {completing && (
        <MicroReflection
          task={completing}
          onClose={() => setCompleting(null)}
          onDone={() => {
            setDoneIds(prev => new Set([...prev, completing.id]))
            setCompleting(null)
            router.refresh()
          }}
        />
      )}

      {detail && (
        <TaskDetail
          task={detail}
          projects={projects}
          streak={streaks[detail.id] ?? null}
          gcalWriteEnabled={gcalWriteEnabled}
          onClose={() => { setDetail(null); router.refresh() }}
        />
      )}

      {loggingHabit && (
        <LogHabitModal
          habit={loggingHabit}
          gcalWriteEnabled={gcalWriteEnabled}
          onClose={() => setLoggingHabit(null)}
          onLogged={logged => {
            if (logged === dayStr) setDoneIds(prev => new Set([...prev, loggingHabit.id]))
            setLoggingHabit(null)
            router.refresh()
          }}
        />
      )}

      {preview && (
        <SchedulePreviewModal
          loading={preview.loading}
          blocks={preview.blocks}
          unschedulable={preview.unschedulable}
          existing={preview.existing}
          onClose={() => setPreview(null)}
          onConfirmed={() => { setPreview(null); router.refresh() }}
        />
      )}
    </>
  )
}

// ── Section 2: Do this now ───────────────────────────────────────────────────

function Section({ title, count, children }: {
  title: string; count?: number; children: React.ReactNode
}) {
  return (
    <section className="flex flex-col min-w-0">
      <div className="flex items-baseline gap-3 mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h2>
        {count !== undefined && <span className="text-xs text-slate-400 tabular-nums">{count}</span>}
        <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800" />
      </div>
      {children}
    </section>
  )
}

/**
 * The recommendation: one primary, two alternates, each carrying why it was
 * picked. A suggestion without a reason is an oracle, and an oracle that is
 * wrong once stops being trusted.
 */
function DoThisNow({ suggestions, onOpen, onStart, onDone, timerBusy }: {
  suggestions: Suggestion[]
  onOpen:  (id: string) => void
  onStart: (id: string) => void
  onDone:  (id: string) => void
  timerBusy: boolean
}) {
  if (suggestions.length === 0) {
    return (
      <Section title="Do this now">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-6 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">Nothing fits the time you have left today.</p>
          <p className="text-xs text-slate-400 mt-1">
            Free time, an estimate on a task, or a longer working day would each change that.
          </p>
        </div>
      </Section>
    )
  }

  const [primary, ...alternates] = suggestions

  return (
    <Section title="Do this now">
      <div className="rounded-xl border border-accent-200 dark:border-accent-800 bg-white dark:bg-slate-900 overflow-hidden">
        {/* Primary */}
        <div className="px-4 py-3.5 bg-accent-50/60 dark:bg-accent-950/30">
          <div className="flex items-start justify-between gap-4">
            <button onClick={() => onOpen(primary.taskIds[0])} className="min-w-0 text-left group">
              {primary.parentTitle && (
                <p className="text-[11px] text-slate-400 truncate">{primary.parentTitle}</p>
              )}
              <p className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-snug group-hover:text-accent-600 dark:group-hover:text-accent-400 transition-colors">
                {primary.title}
              </p>
            </button>
            <span className="text-xs text-slate-400 font-mono tabular-nums shrink-0 pt-1">
              {formatGapMinutes(primary.minutes)}
            </span>
          </div>

          <Reasons reasons={primary.reasons} />

          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => onStart(primary.taskIds[0])}
              disabled={timerBusy}
              title={timerBusy ? 'A timer is already running' : 'Start a focus session'}
              className="flex items-center gap-1.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium px-3 h-7 rounded-lg hover:opacity-80 disabled:opacity-40 transition-opacity"
            >
              <FocusIcon size={12} /> Start
            </button>
            <button
              onClick={() => onDone(primary.taskIds[0])}
              className={`${CONTROL} px-2.5 font-medium text-slate-500 hover:border-accent-400 hover:text-accent-600 dark:hover:text-accent-400`}
            >
              Done
            </button>
            <button
              onClick={() => onOpen(primary.taskIds[0])}
              className={`${CONTROL} px-2.5 font-medium text-slate-500 hover:border-accent-400 hover:text-accent-600 dark:hover:text-accent-400`}
            >
              Open
            </button>
          </div>
        </div>

        {/* Alternates — same information, less room */}
        {alternates.length > 0 && (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
            {alternates.map(s => (
              <button
                key={s.key}
                onClick={() => onOpen(s.taskIds[0])}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors group"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200 truncate group-hover:text-accent-600 dark:group-hover:text-accent-400 transition-colors">
                    {s.title}
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono tabular-nums shrink-0">
                    {formatGapMinutes(s.minutes)}
                  </span>
                </div>
                <Reasons reasons={s.reasons} small />
              </button>
            ))}
          </div>
        )}
      </div>
    </Section>
  )
}

function Reasons({ reasons, small = false }: { reasons: string[]; small?: boolean }) {
  return (
    <p className={`${small ? 'text-[11px] mt-0.5' : 'text-xs mt-1.5'} text-slate-500 dark:text-slate-400`}>
      {reasons.join(' · ')}
    </p>
  )
}

// ── Section 3: Today's shape ─────────────────────────────────────────────────

/**
 * Events in time order with free gaps as their own rows, each gap saying what
 * fits in it. A drawn hour column was considered and rejected: working hours
 * run into the small hours, so a full axis is a scroll, not a glance.
 */
function TodaysShape({ data, clock, onOpen }: {
  data: HomeData
  clock: (ms: number) => string
  onOpen: (id: string) => void
}) {
  if (data.shape.length === 0) {
    return (
      <Section title="Today's shape">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-6 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">Nothing left on the calendar today.</p>
        </div>
      </Section>
    )
  }

  return (
    <Section title="Today's shape">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
        {data.shape.map(row => row.kind === 'event' ? (
          <div key={row.key} className="flex items-baseline gap-3 px-4 py-2.5">
            <span className="text-[11px] font-mono tabular-nums text-slate-400 w-16 shrink-0 text-right">
              {clock(row.startMs)}
            </span>
            {row.taskId
              ? <FocusIcon size={12} className="text-accent-500 shrink-0 self-center" />
              : <CalendarIcon size={12} className="text-slate-300 dark:text-slate-600 shrink-0 self-center" />}
            <span className="text-[13px] text-slate-700 dark:text-slate-200 truncate">{row.title}</span>
          </div>
        ) : (
          <div key={row.key} className="px-4 py-2.5 bg-slate-50/60 dark:bg-slate-800/20">
            <div className="flex items-baseline gap-3">
              <span className="text-[11px] font-mono tabular-nums text-slate-400 w-16 shrink-0 text-right">
                {clock(row.startMs)}
              </span>
              <span className="text-[11px] font-medium text-accent-600 dark:text-accent-400 tabular-nums">
                {formatGapMinutes(row.minutes)} free
              </span>
              <span className="text-[11px] text-slate-400 font-mono tabular-nums">
                until {clock(row.endMs)}
              </span>
            </div>
            {row.fits.length > 0 && (
              <div className="pl-[4.75rem] mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className="text-[11px] text-slate-400">→</span>
                {row.fits.map((s, i) => (
                  <span key={s.key} className="text-[11px] text-slate-500 dark:text-slate-400">
                    <button
                      onClick={() => onOpen(s.taskIds[0])}
                      className="hover:text-accent-600 dark:hover:text-accent-400 transition-colors underline-offset-2 hover:underline"
                    >
                      {s.title}
                    </button>
                    {i < row.fits.length - 1 && <span className="text-slate-300 dark:text-slate-600">, or</span>}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  )
}

// ── Section 5: Needs attention ───────────────────────────────────────────────

/** Overdue and due today only. Short by design, and empty on a good day. */
function NeedsAttention({ overdue, dueToday, doneIds, onOpen, onDone }: {
  overdue:  AttentionRow[]
  dueToday: AttentionRow[]
  doneIds:  Set<string>
  onOpen: (id: string) => void
  onDone: (id: string) => void
}) {
  const rows = [
    ...overdue.map(r => ({ r, late: true })),
    ...dueToday.map(r => ({ r, late: false })),
  ].filter(({ r }) => !r.taskIds.every(id => doneIds.has(id)))

  if (rows.length === 0) {
    return (
      <Section title="Needs attention">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-5 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">Nothing overdue or due today.</p>
        </div>
      </Section>
    )
  }

  return (
    <Section title="Needs attention" count={rows.length}>
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map(({ r, late }) => (
          <div
            key={r.key}
            className="group flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
          >
            {/* A collapsed chain has no single thing to tick — three readings
                are not done in one click — so it offers the work instead. */}
            {r.stepsLabel ? (
              <span className="w-4 h-4 shrink-0 flex items-center justify-center text-[10px] font-mono tabular-nums text-slate-400">
                {r.taskIds.length}
              </span>
            ) : (
              <button
                onClick={() => onDone(r.taskIds[0])}
                title={`Complete ${r.title}`}
                aria-label={`Complete ${r.title}`}
                className="w-4 h-4 rounded-full border-2 border-slate-300 dark:border-slate-600 shrink-0 hover:border-accent-500 hover:bg-accent-50 dark:hover:bg-accent-950 transition-colors"
              />
            )}
            <button onClick={() => onOpen(r.openId)} className="min-w-0 flex-1 text-left">
              <p className="text-[13px] font-medium text-slate-800 dark:text-slate-100 truncate">{r.title}</p>
              {r.stepsLabel && <p className="text-[11px] text-slate-400">{r.stepsLabel}</p>}
            </button>
            {r.minutes != null && (
              <span className="text-[11px] text-slate-400 font-mono tabular-nums shrink-0">
                <TimeIcon size={10} className="inline-block mr-1 -mt-px" />{formatGapMinutes(r.minutes)}
              </span>
            )}
            <span className={`text-[11px] font-medium shrink-0 flex items-center gap-1 ${
              late ? 'text-red-500' : 'text-amber-500'
            }`}>
              {late ? <OverdueIcon size={11} /> : <WarningIcon size={11} />}
              {late ? 'Overdue' : 'Today'}
            </span>
          </div>
        ))}
      </div>
    </Section>
  )
}
