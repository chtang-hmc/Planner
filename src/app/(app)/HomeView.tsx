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
import { WarningIcon } from '@/components/icons'
import { HabitRow, HabitList, CONTROL } from '@/components/TaskChrome'
import MicroReflection from '@/components/MicroReflection'
import TaskDetail from '@/components/TaskDetail'
import LogHabitModal from '@/components/LogHabitModal'
import SchedulePreviewModal, { type PreviewBlock } from '@/components/SchedulePreviewModal'
import { CapacityBand } from '@/components/ds/CapacityBand'
import { Timeline } from '@/components/ds/Timeline'
import { UnplacedRail, type RailItem, type RailSort } from '@/components/ds/UnplacedRail'
import { saveRailSort } from '@/app/actions/scheduling'
import { confirmTaskEventLink, rejectTaskEventLink } from '@/app/actions/links'
import { bandKind, type BandInput } from '@/lib/band'
import { completeTask } from '@/app/actions/tasks'
import { triggerCalendarSync } from '@/app/actions/calendar'
import { proposeSchedule, type ExistingItem } from '@/app/actions/scheduling'
import type { SchedulerTask } from '@/lib/scheduler'
import { rightNowSentence, type FreeTimeBasis, type HomeData } from '@/lib/home'

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
  /**
   * Whether the free time below was observed or assumed — see `freeTimeBasis`.
   * When it is assumed the page still works, but it says so rather than
   * presenting a number it cannot stand behind.
   */
  freeTime:          FreeTimeBasis
  /** Everything the day-level headline needs — see `bandCopy`. */
  band:              BandInput
  /** What the timeline could not place. Overdue comes from `data.overdue`. */
  railItems:         RailItem[]
  railSort:          RailSort
  /** The working window, e.g. "10:00am — 1:30am". */
  windowLabel:       string | null
}

export default function HomeView({
  data, dayStr, tz, allDayEvents, tasks, habits, habitsDoneToday, streaks, projects,
  gcalWriteEnabled, calendarConnected, syncAge, freeTime, band,
  railItems, railSort, windowLabel,
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
    { loading?: boolean; blocks: PreviewBlock[]; unschedulable: SchedulerTask[]; existing: ExistingItem[]; error?: string | null } | null
  >(null)
  /**
   * A failed calendar refresh, said out loud.
   *
   * There is no toast anywhere in this app, and the refresh control has no
   * modal to put a message in — so it goes inline under the header, next to
   * the sync age it failed to update.
   */
  const [syncError, setSyncError] = useState<string | null>(null)

  /**
   * The stored order wins on arrival, a click wins after — and the click is
   * written through, because Triage reads the rail in its current order and
   * the two have to agree.
   */
  const [sortOverride, setSortOverride] = useState<RailSort | null>(null)
  const sort = sortOverride ?? railSort
  function chooseSort(next: RailSort) {
    setSortOverride(next)
    startTransition(async () => {
      const res = await saveRailSort(next)
      if (res.error) console.error('saveRailSort:', res.error)
    })
  }

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

  /** Completion now happens in the task panel; the band's Start uses the timer. */
  function markDone(id: string) {
    const t = byId.get(id)
    if (t) setCompleting({ ...t, project: t.project ?? INBOX_PROJECT })
  }
  void markDone

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

  /**
   * What the band's primary button does, which is a different thing per state.
   *
   * Undefined where the action is Triage, which is not built: `CapacityBand`
   * then renders no button rather than a dead one. `Start` is the only state
   * whose action exists today, and it is the one the ranking already computes.
   */
  const bandPrimary = (() => {
    // Asked rather than re-derived: the state machine lives in one place and
    // a second copy of "is this the day that fits" would drift from it.
    switch (bandKind(band)) {
      case 'unknown':
        return () => router.push('/settings')
      case 'fitsWithSlack': {
        const pick = data.suggestions[0]
        return pick ? () => startWork(pick.taskIds[0]) : undefined
      }
      // overCapacity and dayOff both lead to Triage; fragmented and nothingDue
      // have no primary by design.
      default:
        return undefined
    }
  })()

  /**
   * Answering the day's one link question.
   *
   * `router.refresh()` rather than local state: confirming removes the task's
   * minutes from `dueTotal`, so the headline above changes, and a page that
   * hides the chip without moving the number would look like nothing happened.
   */
  function decideLink(taskId: string, eventId: string, confirm: boolean) {
    startTransition(async () => {
      const res = confirm
        ? await confirmTaskEventLink(taskId, eventId)
        : await rejectTaskEventLink(taskId, eventId)
      if (res.error) setSyncError(res.error)
      else router.refresh()
    })
  }

  function refreshCalendar() {
    setSyncing(true)
    setSyncError(null)
    startTransition(async () => {
      try {
        await triggerCalendarSync()
        router.refresh()
      } catch (err) {
        // syncCalendarEvents throws when getValidToken() returns null, which is
        // what a revoked or expired refresh token looks like. Logging it left
        // the button cycling through "Syncing…" back to the same stale age with
        // nothing said — and this control is the page's whole answer to
        // staleness, so it is the last thing that should fail quietly.
        console.error('calendar sync failed', err)
        setSyncError(err instanceof Error ? err.message : 'Could not refresh the calendar')
      } finally {
        setSyncing(false)
      }
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
        // `error` arrives beside three empty arrays rather than as a throw.
        // Dropping it showed a connection failure as a day with nothing to do.
        setPreview({
          error: res.error ?? null,
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
        setPreview({
          error: err instanceof Error ? err.message : 'Could not build a plan for today',
          blocks: [], unschedulable: [], existing: [],
        })
      } finally {
        setPlanning(false)
      }
    })
  }

  // ── Right now ──────────────────────────────────────────────────────────────

  const rightNowText = rightNowSentence(data.rightNow, tz)


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

          {/* Said once, above everything the assumption touches: the sentence
              in the header, the free rows in Today's shape, and every "fits
              your 1h 15m" reason under Do this now are all downstream of it. */}
          {!freeTime.observed && (
            <div className="px-6 pb-2.5 flex items-start gap-2">
              <WarningIcon size={12} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-slate-600 dark:text-slate-300 flex-1 leading-relaxed">
                {freeTime.reason === 'no-calendar'
                  ? 'No calendar connected.'
                  : 'Your calendar has not synced yet.'}
                <span className="block text-slate-400">
                  The free time below assumes nothing else is booked.{' '}
                  <a href="/settings" className="underline hover:text-accent-500">
                    {freeTime.reason === 'no-calendar' ? 'Connect a calendar' : 'Check the connection'}
                  </a>{' '}
                  and it becomes how much of today&rsquo;s work actually fits.
                </span>
              </p>
            </div>
          )}

          {syncError && (
            <div className="px-6 pb-2.5 flex items-start gap-2">
              <WarningIcon size={12} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-slate-600 dark:text-slate-300 flex-1 leading-relaxed">
                {syncError}
                {/* Its own line: the messages come from several places and none
                    of them ends in punctuation, so running the two together
                    reads as one broken sentence. */}
                <span className="block text-slate-400">The day below is drawn from whatever was last synced.</span>
              </p>
              <button
                onClick={() => setSyncError(null)}
                aria-label="Dismiss"
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-xs leading-none shrink-0"
              >
                ×
              </button>
            </div>
          )}

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

          {/* The day-level headline, above everything it describes. The
              "Right now" sentence stays in the subhead above: that answers
              what am I in right now, this answers does today work, and one
              sentence carrying both across thirty state combinations is how
              you get a sentence that says neither. */}
          <div className="lg:col-span-5">
            <CapacityBand input={band} onPrimary={bandPrimary} />
          </div>

          {/* Left: the day itself, which is the context for every choice. */}
          <div className="lg:col-span-3 flex flex-col gap-5 min-w-0">
            <Timeline
              rows={data.shape}
              tz={tz}
              windowLabel={windowLabel}
              onOpen={openTask}
              onFill={gcalWriteEnabled ? () => blockToday() : undefined}
              onDecideLink={decideLink}
            />
          </div>

          {/* Right: what did not fit on it, and today's habits.
              "Needs attention" is gone — due-today work is either on the
              timeline or in the rail, so the section had no remaining job, and
              overdue is pinned at the top of the rail where being late is the
              thing that decides the order. */}
          <div className="lg:col-span-2 flex flex-col gap-5 min-w-0">
            <UnplacedRail
              items={railItems}
              overdue={data.overdue.filter(r => !r.taskIds.every(id => doneIds.has(id)))}
              sort={sort}
              totalMinutes={
                railItems.reduce((n, i) => n + (i.minutes ?? 0), 0)
                + data.overdue.reduce((n, r) => n + (r.minutes ?? 0), 0)
              }
              onSort={chooseSort}
              onOpen={openTask}
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
          error={preview.error}
          onClose={() => setPreview(null)}
          onConfirmed={() => { setPreview(null); router.refresh() }}
        />
      )}
    </>
  )
}


/*
 * `DoThisNow` lived here: a card with one primary pick and two alternates.
 * It is gone rather than moved. The recommendation survives distributed into
 * the free slots of Today's shape, where it can name the gap it fits — "two
 * tasks fit exactly", "best window before Piano" — and a card beside them was
 * the same answer given twice, once without the context that made it good.
 *
 * The band above carries what is left: on a day with slack its primary is
 * `Start [task]`, which is this card's job reduced to the one case where there
 * is a single obvious answer.
 */

/*
 * `TodaysShape` and `NeedsAttention` lived here.
 *
 * The first is now `Timeline`, which draws the same rows with the parts that
 * make them actionable: a rail in the project's colour, slots that expand by
 * whether you can act on them, and a caution on the block after the cutoff.
 *
 * The second is gone entirely. Due-today work is either placed on the timeline
 * or sitting in the rail, so the section had no remaining job — and overdue,
 * its only distinct content, is pinned at the top of the rail, where being
 * late decides the order instead of competing with size.
 */
