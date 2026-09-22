'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import { useStored } from '@/lib/use-stored'
import { Task, Project, CalendarEvent } from '@/types'
import { daysSinceWeekStart } from '@/lib/week'
import { useSearch } from '@/contexts/SearchContext'
import { updateTask } from '@/app/actions/tasks'
import { TASK_LAYOUT_IMPLS } from '@/components/TaskRowLayouts'
import { getStoredTaskLayout, DEFAULT_TASK_LAYOUT } from '@/lib/task-layouts'
import { WeekStrip } from '@/components/ds/WeekStrip'
import { buildWeekStrip, stripFinding } from '@/lib/week-strip'
import { DaySection, type DayRowModel, type DaySlotModel, type DayAllDayModel } from '@/components/ds/DaySection'
import { findConflicts, conflictedIds } from '@/lib/conflicts'

// ── Date helpers ──────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]
const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function startOfDay(d: Date): Date {
  const r = new Date(d); r.setHours(0,0,0,0); return r
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r
}
/**
 * A local `Date` as its own calendar day.
 *
 * Read from the date's own fields, never through `toISOString()`. Every `Date`
 * here comes from `startOfDay`, which is local midnight — and local midnight
 * east of UTC is still the *previous* day in UTC, so the ISO route labelled
 * every column a day early there. West of UTC the two agree, which is why this
 * survived unnoticed.
 */
function toDateStr(d: Date): string {
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0')
}
function monthHeader(days: Date[]): string {
  const first = days[0], last = days[6]
  if (first.getMonth() === last.getMonth())
    return `${MONTH_NAMES[first.getMonth()]} ${first.getFullYear()}`
  return `${SHORT_MONTHS[first.getMonth()]} – ${SHORT_MONTHS[last.getMonth()]} ${last.getFullYear()}`
}

const HEADER_H = 148  // sticky header height in px; scroll-margin accounts for this

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  tasks:         (Task & { project: Project })[]
  events:        CalendarEvent[]
  projectFilter: string
  doneIds:       Set<string>
  onTaskClick:   (task: Task & { project: Project }) => void
  onTaskDone:    (task: Task & { project: Project }, e: React.MouseEvent) => void
  onAddTask:     (dueDate: string) => void
  weekStartDay:  number
  /** Free minutes per day, for the strip's bars. Missing = a day off. */
  freeByDay:     Record<string, { before: number; after: number }>
  /** The gaps themselves, so free slots sit where they actually fall. */
  gapsByDay:     Record<string, [number, number][]>
  /** Today in the configured timezone, from the server. */
  todayStr:      string
  /** The viewer's timezone, for the clock column in each day. */
  tz:            string
}

export default function UpcomingView({
  tasks, events, projectFilter, doneIds, onTaskClick, onTaskDone, onAddTask, weekStartDay,
  freeByDay, gapsByDay, todayStr: serverToday, tz,
}: Props) {
  const { query } = useSearch()
  const q = query.trim().toLowerCase()
  const today    = startOfDay(new Date())
  const todayStr = toDateStr(today)

  // The date string of the day section currently at the top of the scroll area.
  const [visibleDate, setVisibleDate] = useState(todayStr)

  // How many days forward to render. Grows as the user scrolls near the bottom.
  const [totalDays, setTotalDays] = useState(56)

  // ── Drag state ─────────────────────────────────────────────────────────────

  // taskId currently being dragged
  // Parents whose subtasks are showing. Subtasks inherit their parent's
  // deadline, so an unfolded reading list dumps every chapter into one day —
  // tracking what's OPEN keeps the default tidy, matching the list view.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  /**
   * Fold a flat, urgency-sorted day list into parents followed by their own
   * subtasks. A subtask whose parent isn't in this bucket — a different due
   * date, or filtered out — stays a top-level row rather than disappearing.
   */
  function nest(list: (Task & { project: Project })[]) {
    const present = new Set(list.map(t => t.id))
    const kidsOf  = new Map<string, (Task & { project: Project })[]>()
    for (const t of list) {
      if (t.parent_id && present.has(t.parent_id)) {
        kidsOf.set(t.parent_id, [...(kidsOf.get(t.parent_id) ?? []), t])
      }
    }
    return list
      .filter(t => !(t.parent_id && present.has(t.parent_id)))
      .map(t => ({ task: t, kids: kidsOf.get(t.id) ?? [] }))
  }

  const [draggingId, setDraggingId] = useState<string | null>(null)
  // date section being hovered over during drag
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  // optimistic overrides: taskId -> new dateStr (YYYY-MM-DD)
  const [rescheduled, setRescheduled] = useState<Record<string, string>>({})
  const [, startTransition] = useTransition()

  const contentRef = useRef<HTMLDivElement>(null)

  /**
   * Expanded by proximity, not by preference.
   *
   * Today and tomorrow are open because they are the days you can still act
   * on; the rest collapse to their header. A fortnight of fully expanded days
   * is a scroll, and the strip above already carries the comparison across
   * them. Local state, not a setting — it is a reading position, not a
   * preference, and it should reset when you come back tomorrow.
   */
  const [openDays, setOpenDays] = useState<Set<string>>(
    () => new Set([toDateStr(today), toDateStr(addDays(today, 1))]),
  )

  // Same layout the list view draws, read the same way — the server renders the
  // default and the client swaps in the stored value without a mismatch.
  const layoutId = useStored(getStoredTaskLayout, DEFAULT_TASK_LAYOUT)
  const Layout = TASK_LAYOUT_IMPLS[layoutId]

  // ── Derived ────────────────────────────────────────────────────────────────

  const allDays = Array.from({ length: totalDays }, (_, i) => addDays(today, i))

  const anchorDate  = visibleDate >= todayStr ? startOfDay(new Date(visibleDate + 'T00:00:00')) : today
  /**
   * The fourteen-day strip, from today forward.
   *
   * Due is summed here from the tasks already on screen, so the bars and the
   * day sections below cannot disagree — the same reason the list's group
   * headers count their own rows.
   */
  const dueByDay: Record<string, number> = {}
  for (const t of tasks) {
    if (!t.due_date || doneIds.has(t.id)) continue
    const day = t.due_date.slice(0, 10)
    dueByDay[day] = (dueByDay[day] ?? 0) + (t.adjusted_minutes ?? t.estimated_minutes ?? 0)
  }
  const strip = buildWeekStrip({ todayStr: serverToday, freeByDay, dueByDay })

  const stripStart  = addDays(anchorDate, -daysSinceWeekStart(anchorDate.getDay(), weekStartDay))
  const stripDays   = Array.from({ length: 7 }, (_, i) => addDays(stripStart, i))

  // First day of the week containing today, in the user's configured week start
  const currentWeekStart = addDays(today, -daysSinceWeekStart(today.getDay(), weekStartDay))
  const isCurrentWeek    = toDateStr(stripStart) === toDateStr(currentWeekStart)

  // Apply optimistic rescheduled dates before filtering
  const effectiveTasks = tasks.map(t =>
    rescheduled[t.id]
      ? { ...t, due_date: rescheduled[t.id] + 'T12:00:00.000Z' }
      : t
  )

  const activeTasks = effectiveTasks.filter(t =>
    t.type !== 'habit' &&
    !doneIds.has(t.id) &&
    (projectFilter === 'all' || t.project_id === projectFilter) &&
    (!q || t.title.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q))
  )

  /**
   * The day a task is filed under, as YYYY-MM-DD.
   *
   * A subtask with no deadline of its own follows its parent's. Upcoming places
   * tasks by date, so an undated subtask otherwise appears on no day at all —
   * it vanished from this view entirely while the list, which nests by
   * parent_id, showed it fine. Subtasks are created with the parent's deadline
   * copied, but ones made before that rule (or after the parent's date was
   * cleared) carry null, and a view shouldn't depend on the data being tidy.
   *
   * A subtask that *does* have its own date keeps it, so dragging one to
   * another day still moves it.
   */
  const byId = new Map(effectiveTasks.map(t => [t.id, t]))
  function dueDay(t: Task): string | null {
    if (t.due_date) return t.due_date.slice(0, 10)
    if (t.parent_id) return byId.get(t.parent_id)?.due_date?.slice(0, 10) ?? null
    return null
  }

  const overdueTasks = activeTasks
    .filter(t => { const d = dueDay(t); return d !== null && d < todayStr })
    .sort((a, b) => b.urgency_score - a.urgency_score)

  function dayEvents(d: Date) {
    const ds = toDateStr(d)
    return events
      .filter(e => e.start_time.slice(0,10) === ds)
      .sort((a, b) => a.start_time.localeCompare(b.start_time))
  }
  function dayTasks(d: Date) {
    const ds = toDateStr(d)
    return activeTasks
      .filter(t => dueDay(t) === ds)
      .sort((a, b) => b.urgency_score - a.urgency_score)
  }

  // ── Drag handlers ──────────────────────────────────────────────────────────

  function handleDragStart(taskId: string, e: React.DragEvent) {
    setDraggingId(taskId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', taskId)
  }

  function handleDragEnd() {
    setDraggingId(null)
    setDropTarget(null)
  }

  function handleDragOver(date: string, e: React.DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTarget(date)
  }

  function handleDragLeave(date: string, e: React.DragEvent) {
    // Only clear if we're leaving the section entirely (not entering a child)
    const related = e.relatedTarget as Node | null
    const section = document.getElementById(`day-${date}`)
    if (section && related && section.contains(related)) return
    if (dropTarget === date) setDropTarget(null)
  }

  function handleDrop(targetDate: string, e: React.DragEvent) {
    e.preventDefault()
    const taskId = draggingId ?? e.dataTransfer.getData('text/plain')
    if (!taskId) return
    setDropTarget(null)
    setDraggingId(null)

    // Optimistic: move it immediately
    setRescheduled(prev => ({ ...prev, [taskId]: targetDate }))

    // Persist to server
    startTransition(async () => {
      await updateTask(taskId, { due_date: targetDate + 'T12:00:00.000Z' })
    })
  }

  // ── Scroll helpers ─────────────────────────────────────────────────────────

  function scrollToDate(ds: string) {
    document.getElementById(`day-${ds}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function goToPrevWeek() {
    if (isCurrentWeek) return
    const prevWeek = addDays(stripStart, -7)
    const target = prevWeek < currentWeekStart ? currentWeekStart : prevWeek
    scrollToDate(toDateStr(target))
  }

  function goToNextWeek() {
    const nextWeek = addDays(stripStart, 7)
    const ds = toDateStr(nextWeek)
    const daysOut = Math.ceil((nextWeek.getTime() - today.getTime()) / 86400000)
    if (daysOut + 14 > totalDays) setTotalDays(daysOut + 28)
    setTimeout(() => scrollToDate(ds), 50)
  }

  // ── Scroll listener: update visibleDate + load more ────────────────────────

  useEffect(() => {
    const container = contentRef.current
    if (!container) return

    let scrollEl: Element | null = container.parentElement
    while (scrollEl) {
      const oy = getComputedStyle(scrollEl).overflowY
      if (oy === 'auto' || oy === 'scroll') break
      scrollEl = scrollEl.parentElement
    }
    const target = (scrollEl ?? document.documentElement) as Element

    function update() {
      const sections = container!.querySelectorAll<HTMLElement>('[data-date]')
      let active = todayStr
      for (const section of sections) {
        const containerRect = target.getBoundingClientRect()
        const rect = section.getBoundingClientRect()
        const relTop = rect.top - containerRect.top
        if (relTop <= HEADER_H + 16) {
          active = section.dataset.date!
        } else {
          break
        }
      }
      setVisibleDate(active)

      const sentinel = container!.querySelector('[data-sentinel]') as HTMLElement | null
      if (sentinel) {
        const sRect = sentinel.getBoundingClientRect()
        const cRect = target.getBoundingClientRect()
        if (sRect.top - cRect.top < target.clientHeight * 1.5) {
          setTotalDays(d => d + 28)
        }
      }
    }

    target.addEventListener('scroll', update, { passive: true })
    return () => target.removeEventListener('scroll', update)
  }, [todayStr])

  /**
   * A day's rows: each parent, followed by its subtasks when unfolded.
   *
   * Drawn by the same layout the list view uses, so switching between List and
   * Upcoming doesn't change what a task looks like. Only `Row` is used, not
   * `Shell` — a day section is already a bordered container, and nesting the
   * layout's own container inside it would double the border. The day supplies
   * the dividers instead.
   *
   * Dragging wraps the row rather than living inside it: it's specific to this
   * view, and pushing it into TaskRowProps would mean implementing a drag
   * handle four times for one caller.
   */
  function renderRows(list: (Task & { project: Project })[]) {
    return nest(list).flatMap(({ task, kids }) => {
      const open = expanded.has(task.id)
      return (open ? [task, ...kids] : [task]).map(t => (
        <div
          key={t.id}
          draggable
          onDragStart={e => handleDragStart(t.id, e)}
          onDragEnd={handleDragEnd}
          className={`transition-opacity ${draggingId === t.id ? 'opacity-40' : ''}`}
        >
          <Layout.Row
            task={t}
            isChild={t.id !== task.id}
            kidCount={t.id === task.id ? kids.length : 0}
            collapsed={!open}
            streak={null}
            onToggleFold={() => toggleExpanded(task.id)}
            onOpen={() => onTaskClick(t)}
            onDone={e => onTaskDone(t, e)}
          />
        </div>
      ))
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-950">

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-10 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">

        {/* Month + nav */}
        <div className="px-6 pt-4 pb-2 flex items-center justify-between">
          {/* Not an `h1`: the page is Tasks, and this is where in it you are.
              It was `text-xl font-bold`, which outranked the page title above
              it and gave the screen two competing headings. */}
          <h2 className="text-[15px] font-semibold text-ink-2">
            {monthHeader(stripDays)}
          </h2>
          <div className="flex items-center gap-1">
            <button
              onClick={goToPrevWeek}
              disabled={isCurrentWeek}
              className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-colors ${
                isCurrentWeek
                  ? 'text-slate-200 dark:text-slate-700 cursor-default'
                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer'
              }`}
            >‹</button>

            <button
              onClick={() => scrollToDate(todayStr)}
              className="px-3 h-7 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >Today</button>

            <button
              onClick={goToNextWeek}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-sm cursor-pointer"
            >›</button>
          </div>
        </div>

        {/* The strip, rebuilt.

            It ran Monday to Sunday with today at the far right, so a view
            called Upcoming showed mostly the past — and its bars carried no
            scale, so there was nothing to read across columns. Fourteen days
            from today, two bars each, one shared scale. */}
        <div className="px-6 pb-3">
          <WeekStrip
            strip={strip}
            finding={stripFinding(strip)}
            selected={visibleDate}
            onPick={scrollToDate}
          />
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div ref={contentRef} className="px-6 py-4 flex flex-col gap-6">

        {/* Overdue */}
        {overdueTasks.length > 0 && (
          <section
            id="day-overdue"
            style={{ scrollMarginTop: HEADER_H + 'px' }}
            onDragOver={e => handleDragOver('overdue', e)}
            onDragLeave={e => handleDragLeave('overdue', e)}
            onDrop={e => {
              // dropping on overdue keeps the old due_date but we'll skip rescheduling here
              e.preventDefault()
              setDropTarget(null)
              setDraggingId(null)
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-red-500">Overdue</h2>
              <span className="text-xs text-red-400">{overdueTasks.length} task{overdueTasks.length > 1 ? 's' : ''}</span>
            </div>
            <div className={`flex flex-col divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900 rounded-xl border overflow-hidden transition-colors ${
              dropTarget === 'overdue'
                ? 'border-accent-400 dark:border-accent-500 ring-1 ring-accent-300 dark:ring-accent-600'
                : 'border-red-100 dark:border-red-900/40'
            }`}>
              {renderRows(overdueTasks)}
            </div>
          </section>
        )}

        {/* Continuous day sections.

            The header is new: capacity, verdict, a clash count and a collapse.
            The rows beneath it are the same draggable rows as before — drag
            between days is the reason this view exists, and it predates the
            redesign, so it is preserved rather than rebuilt.

            Tighter than the `gap-6` around them: the day's name used to sit
            outside its card and needed the air to read as a heading. It is
            inside the card now, so the same gap would just be a gutter between
            fourteen mostly-collapsed rows. */}
        <div className="flex flex-col gap-2">
        {allDays.map(d => {
          const ds      = toDateStr(d)
          const evts    = dayEvents(d)
          const dtasks  = dayTasks(d)
          const isToday = ds === todayStr
          const isDropTarget = dropTarget === ds && draggingId !== null

          const timedEvents = evts.filter(e => !e.all_day)
          const clashes = findConflicts(timedEvents.map(e => ({
            id: e.id, title: e.title,
            startMs: Date.parse(e.start_time), endMs: Date.parse(e.end_time),
          })))
          const clashing = conflictedIds(clashes)

          const rows: DayRowModel[] = timedEvents.map(e => ({
            key: e.id,
            startMs: Date.parse(e.start_time),
            endMs: Date.parse(e.end_time),
            title: e.title,
            color: null,
            minutes: Math.round((Date.parse(e.end_time) - Date.parse(e.start_time)) / 60_000),
            clashes: clashing.has(e.id),
          }))

          const slots: DaySlotModel[] = (gapsByDay[ds] ?? []).map(([gS, gE]) => ({
            key: `slot-${gS}`,
            startMs: gS,
            minutes: Math.round((gE - gS) / 60_000),
            reason: null,
          }))

          const allDay: DayAllDayModel[] = evts
            .filter(e => e.all_day)
            .map(e => ({ key: e.id, title: e.title, color: null }))

          const free = freeByDay[ds]
          const due = dtasks.reduce((n, t) => n + (t.adjusted_minutes ?? t.estimated_minutes ?? 0), 0)

          return (
            <div
              key={ds}
              id={`day-${ds}`}
              data-date={ds}
              style={{ scrollMarginTop: (HEADER_H + 8) + 'px' }}
              onDragOver={e => handleDragOver(ds, e)}
              onDragLeave={e => handleDragLeave(ds, e)}
              onDrop={e => handleDrop(ds, e)}
            >
              <DaySection
                label={`${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}`}
                weekday={DAY_ABBR[d.getDay()]}
                isToday={isToday}
                tz={tz}
                /* A day with no working hours has no ratio to draw, and
                   `freeByDay` simply has no entry for one. */
                capacity={free
                  ? { dueTotal: due, freeBeforeCutoff: free.before, freeAfterCutoff: free.after }
                  : null}
                rows={rows}
                slots={slots}
                allDay={allDay}
                expanded={openDays.has(ds)}
                conflictCount={clashes.length}
                /* The footer needs the packer to know what genuinely will not
                   fit, which is Triage's job. Counting "due and unscheduled"
                   here would call a task unplaceable that fits the next gap. */
                unplacedCount={0}
                unplacedMinutes={0}
                action={null}
                dropActive={isDropTarget}
                onToggle={() => setOpenDays(prev => {
                  const next = new Set(prev)
                  if (next.has(ds)) next.delete(ds); else next.add(ds)
                  return next
                })}
              >
                {dtasks.length > 0 && renderRows(dtasks)}
                {isDropTarget && dtasks.length === 0 && (
                  <div className="px-4 py-3 text-micro text-accent-600 font-medium">
                    Drop to schedule here
                  </div>
                )}
                <button
                  onClick={() => onAddTask(ds)}
                  className="w-full flex items-center gap-2 px-4 py-2 text-micro text-ink-faint hover:text-accent-600 hover:bg-surface-quiet transition-colors"
                >
                  <span className="text-base leading-none">+</span> Add task
                </button>
              </DaySection>
            </div>
          )
        })}
        </div>

        {/* Sentinel */}
        <div data-sentinel="true" className="h-4" />
      </div>
    </div>
  )
}
