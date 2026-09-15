'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import { Task, Project, CalendarEvent, INBOX_PROJECT } from '@/types'
import { daysSinceWeekStart } from '@/lib/week'
import { useSearch } from '@/contexts/SearchContext'
import { updateTask } from '@/app/actions/tasks'

// ── Priority circle ───────────────────────────────────────────────────────────

function priorityCircleClass(priority: 1 | 2 | 3 | 4) {
  switch (priority) {
    case 4: return 'border-red-400    bg-red-50    dark:bg-red-950/40    hover:bg-red-100    dark:hover:bg-red-900/50'
    case 3: return 'border-orange-400 bg-orange-50 dark:bg-orange-950/40 hover:bg-orange-100 dark:hover:bg-orange-900/50'
    case 2: return 'border-blue-400   bg-blue-50   dark:bg-blue-950/40   hover:bg-blue-100   dark:hover:bg-blue-900/50'
    case 1: return 'border-slate-200  bg-white     dark:bg-slate-900     dark:border-slate-700 hover:border-accent-400 hover:bg-accent-50 dark:hover:bg-accent-950'
  }
}

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
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function dayLabel(d: Date, today: Date): string {
  const ds = toDateStr(d), ts = toDateStr(today)
  if (ds === ts) return 'Today'
  if (ds === toDateStr(addDays(today, 1))) return 'Tomorrow'
  return ''
}
function formatTime(iso: string): string {
  const d = new Date(iso)
  let h = d.getHours(); const m = d.getMinutes()
  const p = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12
  return m === 0 ? `${h} ${p}` : `${h}:${String(m).padStart(2,'0')} ${p}`
}
function formatTimeRange(start: string, end: string, allDay: boolean): string {
  return allDay ? 'All day' : `${formatTime(start)}–${formatTime(end)}`
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
}

export default function UpcomingView({
  tasks, events, projectFilter, doneIds, onTaskClick, onTaskDone, onAddTask, weekStartDay,
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
  const [draggingId, setDraggingId] = useState<string | null>(null)
  // date section being hovered over during drag
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  // optimistic overrides: taskId -> new dateStr (YYYY-MM-DD)
  const [rescheduled, setRescheduled] = useState<Record<string, string>>({})
  const [, startTransition] = useTransition()

  const contentRef = useRef<HTMLDivElement>(null)

  // ── Derived ────────────────────────────────────────────────────────────────

  const allDays = Array.from({ length: totalDays }, (_, i) => addDays(today, i))

  const anchorDate  = visibleDate >= todayStr ? startOfDay(new Date(visibleDate + 'T00:00:00')) : today
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

  const overdueTasks = activeTasks
    .filter(t => t.due_date && t.due_date.slice(0,10) < todayStr)
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
      .filter(t => t.due_date && t.due_date.slice(0,10) === ds)
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

  // ── Urgency dot ───────────────────────────────────────────────────────────

  function urgencyDot(score: number) {
    if (score >= 70) return 'bg-red-400'
    if (score >= 40) return 'bg-amber-400'
    return 'bg-slate-200 dark:bg-slate-700'
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-950">

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-10 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">

        {/* Month + nav */}
        <div className="px-6 pt-4 pb-2 flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            {monthHeader(stripDays)}
          </h1>
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

        {/* Week strip */}
        <div className="px-6 pb-3 grid grid-cols-7 gap-1">
          {stripDays.map(d => {
            const ds       = toDateStr(d)
            const isToday  = ds === todayStr
            const isPast   = d < today
            const isActive = ds === visibleDate
            const hasSection = !isPast || dayEvents(d).length > 0 || dayTasks(d).length > 0

            return (
              <button
                key={ds}
                onClick={hasSection ? () => scrollToDate(ds) : undefined}
                disabled={!hasSection}
                className={`flex flex-col items-center gap-1 rounded-lg py-1 transition-colors ${
                  hasSection
                    ? 'hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer'
                    : 'opacity-30 cursor-default'
                }`}
              >
                <span className={`text-xs font-medium transition-colors ${
                  isActive && !isToday
                    ? 'text-slate-700 dark:text-slate-200'
                    : 'text-slate-400 dark:text-slate-500'
                }`}>
                  {DAY_ABBR[d.getDay()]}
                </span>
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                  isToday
                    ? 'bg-red-500 text-white'
                    : isActive
                    ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100 font-semibold'
                    : 'text-slate-600 dark:text-slate-300'
                }`}>
                  {d.getDate()}
                </span>
              </button>
            )
          })}
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
              {overdueTasks.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onDone={e => onTaskDone(task, e)}
                  onClick={() => onTaskClick(task)}
                  urgencyDotClass={urgencyDot(task.urgency_score)}
                  isDragging={draggingId === task.id}
                  onDragStart={e => handleDragStart(task.id, e)}
                  onDragEnd={handleDragEnd}
                />
              ))}
            </div>
          </section>
        )}

        {/* Continuous day sections */}
        {allDays.map(d => {
          const ds      = toDateStr(d)
          const evts    = dayEvents(d)
          const dtasks  = dayTasks(d)
          const isToday = ds === todayStr
          const special = dayLabel(d, today)
          const isDropTarget = dropTarget === ds && draggingId !== null

          return (
            <section
              key={ds}
              id={`day-${ds}`}
              data-date={ds}
              style={{ scrollMarginTop: (HEADER_H + 8) + 'px' }}
              onDragOver={e => handleDragOver(ds, e)}
              onDragLeave={e => handleDragLeave(ds, e)}
              onDrop={e => handleDrop(ds, e)}
            >
              {/* Day header */}
              <div className="flex items-baseline gap-2 mb-2">
                <h2 className={`text-sm font-bold ${
                  isToday ? 'text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'
                }`}>
                  {SHORT_MONTHS[d.getMonth()]} {d.getDate()}
                </h2>
                {special && (
                  <span className={`text-xs font-semibold ${isToday ? 'text-red-500' : 'text-slate-400'}`}>
                    · {special}
                  </span>
                )}
                <span className="text-xs text-slate-400">· {DAY_ABBR[d.getDay()]}</span>
              </div>

              <div className={`bg-white dark:bg-slate-900 rounded-xl border overflow-hidden transition-all ${
                isDropTarget
                  ? 'border-accent-400 dark:border-accent-500 ring-1 ring-accent-300 dark:ring-accent-600 shadow-sm'
                  : 'border-slate-200 dark:border-slate-800'
              }`}>
                {/* Calendar events */}
                {evts.length > 0 && (
                  <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                    {evts.map(ev => (
                      <div key={ev.id} className="flex items-start gap-2.5 py-1">
                        <div className="w-0.5 min-h-[1.25rem] self-stretch bg-sky-400 dark:bg-sky-500 rounded-full shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <span className="text-xs text-slate-400 font-mono mr-2 shrink-0">
                            {formatTimeRange(ev.start_time, ev.end_time, ev.all_day)}
                          </span>
                          <span className="text-xs text-slate-700 dark:text-slate-300 font-medium">{ev.title}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Tasks */}
                {dtasks.length > 0 && (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {dtasks.map(task => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        onDone={e => onTaskDone(task, e)}
                        onClick={() => onTaskClick(task)}
                        urgencyDotClass={urgencyDot(task.urgency_score)}
                        isDragging={draggingId === task.id}
                        onDragStart={e => handleDragStart(task.id, e)}
                        onDragEnd={handleDragEnd}
                      />
                    ))}
                  </div>
                )}

                {/* Drop hint when dragging over an empty/future day */}
                {isDropTarget && dtasks.length === 0 && evts.length === 0 && (
                  <div className="px-4 py-3 text-xs text-accent-500 dark:text-accent-400 font-medium">
                    Drop to schedule here
                  </div>
                )}

                {/* Empty state placeholder */}
                {!isDropTarget && evts.length === 0 && dtasks.length === 0 && (
                  <div className="px-4 py-2 text-xs text-slate-300 dark:text-slate-600 select-none">
                    Free
                  </div>
                )}

                {/* Add task */}
                <button
                  onClick={() => onAddTask(ds)}
                  className="w-full flex items-center gap-2 px-4 py-2 text-xs text-slate-400 hover:text-accent-600 dark:hover:text-accent-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <span className="text-base leading-none">+</span> Add task
                </button>
              </div>
            </section>
          )
        })}

        {/* Sentinel */}
        <div data-sentinel="true" className="h-4" />
      </div>
    </div>
  )
}

// ── Shared task row ───────────────────────────────────────────────────────────

function TaskRow({
  task, onDone, onClick, urgencyDotClass, isDragging, onDragStart, onDragEnd,
}: {
  task: Task & { project: Project }
  onDone: (e: React.MouseEvent) => void
  onClick: () => void
  urgencyDotClass: string
  isDragging: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
}) {
  const proj = task.project ?? INBOX_PROJECT
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`group flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-all ${
        isDragging ? 'opacity-40 bg-slate-50 dark:bg-slate-800/50' : ''
      }`}
    >
      {/* Drag handle — visible on group hover */}
      <span
        className="opacity-0 group-hover:opacity-100 text-slate-300 dark:text-slate-600 select-none shrink-0 cursor-grab active:cursor-grabbing text-xs leading-none -ml-1 mr-0.5 transition-opacity"
        onMouseDown={e => e.stopPropagation()} // prevent click handler from firing on handle
      >
        ⠿
      </span>

      <button
        onClick={e => { e.stopPropagation(); onDone(e) }}
        className={`w-4 h-4 rounded-full border-2 shrink-0 transition-all mt-0.5 ${priorityCircleClass(task.priority)}`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm text-slate-800 dark:text-slate-200 font-medium leading-snug">{task.title}</span>
          {task.type === 'recurring' && <span className="text-xs text-violet-400">↻</span>}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span
            className="text-xs font-medium px-1.5 py-0.5 rounded"
            style={{ background: proj.color + '18', color: proj.color }}
          >
            {proj.name}
          </span>
          {task.estimated_minutes && (
            <span className="text-xs text-slate-400 font-mono">
              {task.estimated_minutes < 60 ? `${task.estimated_minutes}m` : `${Math.floor(task.estimated_minutes/60)}h`}
            </span>
          )}
        </div>
      </div>
      <div className={`w-2 h-2 rounded-full shrink-0 ${urgencyDotClass}`} />
    </div>
  )
}
