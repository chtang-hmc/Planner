'use client'

import { useState, useTransition } from 'react'
import { useStored } from '@/lib/use-stored'
import { Task, Project, EnergyLevel, HabitStreak, CalendarEvent, INBOX_PROJECT } from '@/types'
import { useSearch } from '@/contexts/SearchContext'
import { getStoredDefaultView } from '@/app/(app)/settings/SettingsView'
import { completeTask } from '@/app/actions/tasks'
import { proposeSchedule, type ExistingItem } from '@/app/actions/scheduling'
import type { SchedulerTask } from '@/lib/scheduler'
import MicroReflection from '@/components/MicroReflection'
import TaskDetail from '@/components/TaskDetail'
import AddTaskModal from '@/components/AddTaskModal'
import SchedulePreviewModal, { type PreviewBlock } from '@/components/SchedulePreviewModal'
import LogHabitModal from '@/components/LogHabitModal'
import UpcomingView from './UpcomingView'
import { CONTROL, Segmented, Toggle, HabitRow, HabitList } from '@/components/TaskChrome'
import { TaskRow, GroupHeader } from '@/components/ds/TaskRow'
import { toTaskRowModel } from '@/lib/task-row'
import { formatMinutes } from '@/lib/task-format'
import { addDays } from '@/lib/day'
import { isRelevant, relevanceHint, RELEVANCE_DEFAULT, type RelevanceConfig } from '@/lib/relevance'


/** Rows carry a `parent` embed so a subtask can show what it belongs to. */
export type TaskRow = Task & { project: Project; parent?: { id: string; title: string } | null }

interface Props {
  tasks: TaskRow[]
  projects: Project[]
  streaks: Record<string, HabitStreak>
  events: CalendarEvent[]
  gcalWriteEnabled: boolean
  weekStartDay: number
  /** The two numbers behind the Relevant toggle, from Settings. */
  relevance?: RelevanceConfig
  /** Today in the configured timezone, from the server — see the filter below. */
  todayStr: string
  /**
   * Free minutes per day, either side of the cutoff, for the capacity meter in
   * each date group header. Only the free half: what is *due* on a day is the
   * group this component has already built, and sending it down as well would
   * be the same number arrived at twice — disagreeing the moment a filter hid
   * a row.
   */
  freeByDay: Record<string, { before: number; after: number }>
  /** The gaps themselves, for Upcoming's inline free slots. */
  gapsByDay: Record<string, [number, number][]>
}

export default function TaskList({
  tasks, projects, streaks, events, gcalWriteEnabled, weekStartDay,
  relevance = RELEVANCE_DEFAULT, todayStr, freeByDay, gapsByDay,
}: Props) {
  const { query } = useSearch()
  /**
   * Which view opens. The choice lives in localStorage, so the server cannot
   * know it — and a `typeof window` branch inside a useState initialiser is not
   * a way around that. It renders `list` on the server and `upcoming` on the
   * client for anyone who changed the setting, which is a hydration mismatch:
   * React discards the server tree and rebuilds it, and the console says so.
   *
   * `useStored` is the same read done in one pass React knows about. The
   * override holds a choice made since load, so the stored value wins on
   * arrival and the toggle wins afterwards. Settings already reads it this way.
   */
  const storedView = useStored<'list' | 'upcoming'>(getStoredDefaultView, 'list')
  const [viewOverride, setViewOverride] = useState<'list' | 'upcoming' | null>(null)
  const view = viewOverride ?? storedView
  const setView = setViewOverride
  const [energyFilter, setEnergyFilter]   = useState<EnergyLevel | 'all'>('all')
  const [projectFilter, setProjectFilter] = useState<string>('all')
  const [showSomeday, setShowSomeday]     = useState(false)
  const [relevantOnly, setRelevantOnly]   = useState(true)
  // Parents whose subtasks are showing. Tracking what's OPEN rather than what's
  // shut means the default — an empty set — is everything tucked away.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleFold = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  /**
   * One grouping, chosen once.
   *
   * `By project` was a toggle beside `Relevant` and `Someday`, which put a
   * grouping, a filter and another filter in one row of identical pills — three
   * different kinds of thing wearing the same control.
   */
  const [group, setGroup] = useState<'date' | 'project' | 'energy'>('date')
  const groupByProject = group === 'project'
  // Same trick for project sections: grouping exists to compress a long list
  // into something you can survey, so it opens compact and you expand the one
  // project you came for.
  const [openProjects, setOpenProjects] = useState<Set<string>>(new Set())
  // Completing a regular task (opens MicroReflection)
  const [completingTask, setCompletingTask] = useState<(Task & { project: Project }) | null>(null)
  const [doneIds, setDoneIds]               = useState<Set<string>>(new Set())

  // Completing a habit (instant — no reflection)
  const [pendingHabitIds, setPendingHabitIds] = useState<Set<string>>(new Set())
  // Habit whose "log at a time" sheet is open
  const [loggingHabit, setLoggingHabit] = useState<TaskRow | null>(null)

  // Task detail
  const [detailTask, setDetailTask] = useState<(Task & { project: Project }) | null>(null)

  // Add task modal
  const [showAddTask, setShowAddTask]       = useState(false)
  const [addTaskDueDate, setAddTaskDueDate] = useState<string | undefined>(undefined)

  // Scheduling modals
  const [schedulePreview, setSchedulePreview] = useState<{
    loading?: boolean; blocks: PreviewBlock[]; unschedulable: SchedulerTask[]; existing: ExistingItem[]
    error?: string | null
  } | null>(null)
  const [scheduling, setScheduling] = useState(false)
  const [, startTransition] = useTransition()

  // Client-side only: Intl on the server resolves to the deployment's zone, not
  // the user's. Read through useStored so the server renders UTC and the client
  // the real value in one pass, rather than rendering a known-wrong value and
  // correcting it in an effect.
  const tz = useStored(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    'UTC',
  )
  function handleScheduleWeek() {
    if (!gcalWriteEnabled) return
    setScheduling(true)
    // Open the modal straight away in a loading state — the proposal takes a
    // GCal round trip, and a dead button for that long reads as broken.
    setSchedulePreview({ loading: true, blocks: [], unschedulable: [], existing: [] })
    startTransition(async () => {
      try {
        const res = await proposeSchedule(7, tz)
        // Returned, not thrown — dropping it showed "Google Calendar not
        // connected" as a week with nothing worth scheduling.
        setSchedulePreview({
          error: res.error ?? null,
          blocks: res.scheduled.map(b => ({
            taskId: b.taskId, taskTitle: b.taskTitle, taskPriority: b.taskPriority,
            startISO: b.startISO, endISO: b.endISO,
            segmentIndex: b.segmentIndex, totalSegments: b.totalSegments, energyMatch: b.energyMatch,
          })),
          unschedulable: res.unschedulable,
          existing: res.existing,
        })
      } catch (err) {
        // Don't strand the modal in its loading state if the proposal throws
        console.error('proposeSchedule failed', err)
        setSchedulePreview({
          error: err instanceof Error ? err.message : 'Could not build a schedule',
          blocks: [], unschedulable: [], existing: [],
        })
      } finally {
        setScheduling(false)
      }
    })
  }

  // Search filter helper
  const q = query.trim().toLowerCase()
  function matchesSearch(t: Task) {
    if (!q) return true
    return (
      t.title.toLowerCase().includes(q) ||
      (t.description ?? '').toLowerCase().includes(q)
    )
  }

  // Date bounds for the relevance filter.
  //
  // `today` comes from the server, computed against the configured timezone,
  // rather than from `new Date()` here. Reading the clock during render is the
  // same hydration hazard as reading localStorage: deployed, the server runs in
  // UTC and the browser does not, so for part of every day the two disagree
  // about what day it is — and the row count in the header above is built from
  // this filter. The horizon is then pure string arithmetic on that day.
  const horizonStr = addDays(todayStr, relevance.windowDays)

  // Split habits from regular tasks
  const habits  = tasks.filter(t => t.type === 'habit' && !doneIds.has(t.id) && matchesSearch(t))
  const filtered = tasks.filter(t => {
    if (t.type === 'habit') return false          // habits have their own section
    if (doneIds.has(t.id)) return false
    if (!showSomeday && t.type === 'someday') return false
    if (energyFilter !== 'all' && t.energy_required !== energyFilter) return false
    if (projectFilter !== 'all' && t.project_id !== projectFilter) return false
    if (!matchesSearch(t)) return false
    // A subtask rides on its parent's relevance: parents pass their deadline
    // down, but a chain member with no date of its own would otherwise vanish
    // out from under a parent that's still showing.
    if (relevantOnly && !isRelevant(t, todayStr, horizonStr, relevance.minPriority)) {
      const parent = t.parent_id ? tasks.find(p => p.id === t.parent_id) : null
      if (!parent || !isRelevant(parent, todayStr, horizonStr, relevance.minPriority)) return false
    }
    return true
  })

  // Subtasks nest under their parent instead of sitting loose in the list.
  // A parent that survived the filter owns its children; a subtask whose parent
  // was filtered out (or isn't in this view) still shows on its own, so nothing
  // silently disappears.
  const visibleIds = new Set(filtered.map(t => t.id))
  const childrenOf = new Map<string, TaskRow[]>()
  for (const t of filtered) {
    if (t.parent_id && visibleIds.has(t.parent_id)) {
      childrenOf.set(t.parent_id, [...(childrenOf.get(t.parent_id) ?? []), t])
    }
  }
  const topLevel = filtered.filter(t => !(t.parent_id && visibleIds.has(t.parent_id)))

  // Project groups, in the order the sidebar lists them, with Inbox last.
  const projectGroups = (() => {
    if (!groupByProject) return null
    const byId = new Map<string, TaskRow[]>()
    for (const t of topLevel) {
      const key = t.project_id ?? ''
      byId.set(key, [...(byId.get(key) ?? []), t])
    }
    const ordered = projects
      .filter(p => byId.has(p.id))
      .map(p => ({ project: p, rows: byId.get(p.id)! }))
    if (byId.has('')) ordered.push({ project: INBOX_PROJECT, rows: byId.get('')! })
    // Collapsed, a header is all you see of the project — so it carries the
    // numbers you'd otherwise have to expand to find.
    return ordered.map(g => ({
      ...g,
      key:     g.project.id || 'inbox',
      // A parent that has subtasks is replaced by them when scheduling, so its
      // own estimate is the same work described twice — counting both made a
      // 135-minute reading list read as 270.
      minutes: g.rows.reduce((s, t) => {
        const kids = childrenOf.get(t.id) ?? []
        return s + (kids.length > 0
          ? kids.reduce((n, r) => n + (r.adjusted_minutes ?? r.estimated_minutes ?? 0), 0)
          : (t.adjusted_minutes ?? t.estimated_minutes ?? 0))
      }, 0),
    }))
  })()

  const totalMinutes = filtered.reduce((s, t) => s + (t.adjusted_minutes ?? t.estimated_minutes ?? 0), 0)

  function handleDone(task: Task & { project: Project }, e: React.MouseEvent) {
    e.stopPropagation()
    setCompletingTask(task)
  }

  function onReflectionDone() {
    if (completingTask) setDoneIds(prev => new Set([...prev, completingTask.id]))
    setCompletingTask(null)
  }

  async function handleHabitDone(task: Task & { project: Project }, e: React.MouseEvent) {
    e.stopPropagation()
    if (pendingHabitIds.has(task.id)) return
    setPendingHabitIds(prev => new Set([...prev, task.id]))
    try {
      await completeTask(task.id, null, null, null)
      setDoneIds(prev => new Set([...prev, task.id]))
    } finally {
      setPendingHabitIds(prev => { const n = new Set(prev); n.delete(task.id); return n })
    }
  }

  // Open add task modal, pre-filling due date when coming from UpcomingView
  function openAddTask(dueDate?: string) {
    setAddTaskDueDate(dueDate)
    setShowAddTask(true)
  }

  const toRowModel = (task: TaskRow, kidCount: number) =>
    toTaskRowModel(task, { kidCount, todayStr })

  /**
   * Date groups, in the order a day arrives: what is already late, then today,
   * then forward, then the undated tail.
   *
   * Overdue is its own group rather than folded into Today, because the two
   * answer different questions and a capacity meter over both would be a
   * number for a day that has not got a deadline.
   */
  const dateGroups = (() => {
    if (group !== 'date') return null
    const buckets = new Map<string, TaskRow[]>()
    for (const t of topLevel) {
      const day = t.due_date?.slice(0, 10) ?? null
      const key = day == null ? 'none' : day < todayStr ? 'overdue' : day
      buckets.set(key, [...(buckets.get(key) ?? []), t])
    }

    const dayLabel = (key: string) => {
      if (key === todayStr) return 'Today'
      if (key === addDays(todayStr, 1)) return 'Tomorrow'
      const d = new Date(key + 'T12:00:00Z')
      return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
    }

    const dated = [...buckets.keys()]
      .filter(k => k !== 'overdue' && k !== 'none')
      .sort()

    return [
      ...(buckets.has('overdue') ? [{ key: 'overdue', label: 'Overdue', rows: buckets.get('overdue')!, day: null }] : []),
      ...dated.map(k => ({ key: k, label: dayLabel(k), rows: buckets.get(k)!, day: k })),
      ...(buckets.has('none') ? [{ key: 'none', label: 'No date', rows: buckets.get('none')!, day: null }] : []),
    ]
  })()

  /**
   * Rows for a set of top-level tasks, each followed by its subtasks.
   *
   * The row itself is drawn by whichever layout is selected — see
   * src/lib/task-layouts.ts. This function owns which rows exist and in what
   * order; the layout owns what one looks like.
   */
  /**
   * One row, whatever the grouping.
   *
   * This used to draw `Layout.Row` — one of the four interchangeable layouts —
   * while the date-grouped branch below drew the shared `ds/TaskRow`. So the
   * same task was 13px semibold under *Group: Project* and 14px regular under
   * *Group: Date*, on one screen. See #73 for the rest of the removal;
   * Upcoming still has the old rows.
   */
  function renderTaskRows(list: TaskRow[]) {
    return (
      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        {list.flatMap(parentTask => {
          const kids = childrenOf.get(parentTask.id) ?? []
          const folded = !expanded.has(parentTask.id)
          return (folded ? [parentTask] : [parentTask, ...kids]).map(task => (
            <TaskRow
              key={task.id}
              task={toRowModel(task, task.id === parentTask.id ? kids.length : 0)}
              isChild={task.id !== parentTask.id}
              folded={task.id === parentTask.id && kids.length > 0 ? folded : undefined}
              onFold={task.id === parentTask.id && kids.length > 0 ? () => toggleFold(parentTask.id) : undefined}
              onOpen={() => setDetailTask({ ...task, project: task.project ?? INBOX_PROJECT })}
              onToggle={() => setCompletingTask({ ...task, project: task.project ?? INBOX_PROJECT })}
            />
          ))
        })}
      </div>
    )
  }

  return (
    <>
      <div className="min-h-full bg-slate-50 dark:bg-slate-950">
        {/* Top bar */}
        {/* ── Toolbar ──────────────────────────────────────────────────────
            Title and the one primary action on top; view, filters and the
            scheduling actions beneath. The filter row used to sit in a separate
            band below the header with three different control idioms in it — a
            segmented control, a bare <select> and toggle pills. They are all one
            idiom now: same height, same border, same radius, accent only when a
            control is doing something. */}
        <header className="sticky top-0 z-10 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur">
          <div className="px-6 pt-4 pb-3 flex flex-col gap-3">

            <div className="flex items-baseline justify-between gap-4">
              <div className="flex items-baseline gap-3 min-w-0">
                <h1 className="display text-display-m text-ink leading-tight">Tasks</h1>
                {view === 'list' && (
                  <span className="text-xs text-slate-400 tabular-nums truncate">
                    {filtered.length} {filtered.length === 1 ? 'task' : 'tasks'}
                    {totalMinutes > 0 && ` · ${formatMinutes(totalMinutes)}`}
                  </span>
                )}
              </div>
              {/* Actions live together: scheduling and Add task are things you
                  do, not ways of looking at the list. Keeping them out of the
                  filter row also stops the toolbar wrapping into a stray line
                  holding nothing but these two. */}
              <div className="flex items-center gap-2 shrink-0">
                {/* Planning one day moved to Home, which is the page you
                    land on and where the day is already drawn. The week is
                    still a list-level action: it is about the backlog, not
                    about today. */}
                {gcalWriteEnabled && (
                  <button
                    onClick={handleScheduleWeek}
                    disabled={scheduling}
                    title="Schedule my week — auto-fill the week with your tasks"
                    className={`${CONTROL} px-3 font-medium text-slate-500 hover:border-accent-400 hover:text-accent-600 dark:hover:text-accent-400 disabled:opacity-40`}
                  >
                    {scheduling ? '…' : 'Schedule week'}
                  </button>
                )}
                <button
                  onClick={() => openAddTask()}
                  className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium px-3.5 h-7 rounded-lg hover:opacity-80 transition-opacity"
                >
                  Add task
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Segmented
                value={view}
                onChange={v => setView(v as 'list' | 'upcoming')}
                options={[{ id: 'list', label: 'List' }, { id: 'upcoming', label: 'Upcoming' }]}
              />

              {view === 'list' && (
                <>
                  <span className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-0.5" />

                  {/* One row, one height, one idiom. What differs between
                      these is what they *do*, not how they look: a grouping, a
                      filter, a filter, a filter. */}
                  <Segmented
                    value={group}
                    onChange={v => setGroup(v as 'date' | 'project' | 'energy')}
                    options={[
                      { id: 'date', label: 'Date' }, { id: 'project', label: 'Project' },
                      { id: 'energy', label: 'Energy' },
                    ]}
                    hint="Group"
                  />

                  <Segmented
                    value={energyFilter}
                    onChange={v => setEnergyFilter(v as EnergyLevel | 'all')}
                    options={[
                      { id: 'all', label: 'Any' }, { id: 'low', label: 'Low' },
                      { id: 'medium', label: 'Med' }, { id: 'high', label: 'High' },
                    ]}
                    hint="Energy"
                  />

                  <select
                    value={projectFilter}
                    onChange={e => setProjectFilter(e.target.value)}
                    className={`${CONTROL} px-2.5 text-slate-600 dark:text-slate-300 max-w-[10rem]`}
                  >
                    <option value="all">All projects</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>

                  <Toggle on={showSomeday} onClick={() => setShowSomeday(v => !v)} title="Include someday tasks">
                    Someday
                  </Toggle>

                  {/* Kept, and not in the redesign's five. The spec drops it,
                      but it is on by default and decides what the list looks
                      like on arrival — and both its numbers are settings
                      (migration 0017) that nothing else reads. Removing it is
                      a decision about those settings too. */}
                  <Toggle
                    on={relevantOnly}
                    onClick={() => setRelevantOnly(v => !v)}
                    title={relevanceHint(relevance)}
                  >
                    Relevant
                  </Toggle>
                </>
              )}

            </div>
          </div>
        </header>

        {/* ── Upcoming view ── */}
        {view === 'upcoming' && (
          <UpcomingView
            tasks={tasks}
            events={events}
            projectFilter={projectFilter}
            doneIds={doneIds}
            onTaskClick={t => setDetailTask({ ...t, project: t.project ?? INBOX_PROJECT })}
            onTaskDone={(task, e) => handleDone(task, e)}
            onAddTask={dueDate => openAddTask(dueDate)}
            weekStartDay={weekStartDay}
            freeByDay={freeByDay}
            gapsByDay={gapsByDay}
            todayStr={todayStr}
            tz={tz}
          />
        )}

        {view === 'list' && (
        <div className="px-6 py-4">

          {/* Task rows */}
          {group === 'date' && dateGroups ? (
            <div className="rounded-xl border border-line bg-surface overflow-hidden">
              {dateGroups.map(g => {
                /**
                 * The sum of the rows beneath it, and nothing cleverer.
                 *
                 * An earlier version substituted a parent's subtasks for its
                 * own estimate, to avoid counting the same work twice. But
                 * only top-level rows are in `g.rows`, so there was nothing to
                 * double-count — and the header then disagreed with the
                 * durations printed under it, which is the one thing a reader
                 * can check. `recalcParentEstimate` keeps a parent's estimate
                 * equal to its subtasks'; if it ever drifts, that is the bug
                 * to fix rather than to paper over here.
                 */
                const due = g.rows.reduce(
                  (n, t) => n + (t.adjusted_minutes ?? t.estimated_minutes ?? 0), 0)
                const free = g.day ? freeByDay[g.day] : undefined

                return (
                  <div key={g.key}>
                    <GroupHeader
                      label={g.label}
                      count={g.rows.length}
                      /* An undated group has nothing for its work to fit
                         inside, and neither does a day off — `freeByDay` has no
                         entry for one, so the meter is simply omitted. */
                      capacity={free
                        ? { dueTotal: due, freeBeforeCutoff: free.before, freeAfterCutoff: free.after }
                        : null}
                    />
                    {/* `expanded` was read here and never written: the only
                        thing calling `setExpanded` lived in `Layout.Row`, which
                        this branch does not draw. A parent showed `3 steps` and
                        there was no way to open it. */}
                    {g.rows.flatMap(parentTask => {
                      const kids = childrenOf.get(parentTask.id) ?? []
                      const folded = !expanded.has(parentTask.id)
                      return (folded ? [parentTask] : [parentTask, ...kids]).map(task => (
                        <TaskRow
                          key={task.id}
                          task={toRowModel(task, task.id === parentTask.id ? kids.length : 0)}
                          isChild={task.id !== parentTask.id}
                          folded={task.id === parentTask.id && kids.length > 0 ? folded : undefined}
                          onFold={task.id === parentTask.id && kids.length > 0 ? () => toggleFold(parentTask.id) : undefined}
                          onOpen={() => setDetailTask({ ...task, project: task.project ?? INBOX_PROJECT })}
                          onToggle={() => setCompletingTask({ ...task, project: task.project ?? INBOX_PROJECT })}
                        />
                      ))
                    })}
                  </div>
                )
              })}
              {filtered.length === 0 && (
                <p className="px-4 py-10 text-center text-small text-ink-ghost">
                  Nothing matches. Try turning off Relevant, or add a task.
                </p>
              )}
            </div>
          ) : (
          <div className="flex flex-col gap-1.5">
            {groupByProject && projectGroups
              ? projectGroups.map(g => {
                  const open = openProjects.has(g.key)
                  return (
                  <div key={g.key} className="flex flex-col gap-1.5">
                    <button
                      onClick={() => setOpenProjects(prev => {
                        const next = new Set(prev)
                        if (next.has(g.key)) next.delete(g.key); else next.add(g.key)
                        return next
                      })}
                      title={open ? 'Collapse' : `Show ${g.rows.length} tasks`}
                      className="flex items-center gap-2 mt-2 first:mt-0 group/proj"
                    >
                      <span className="text-[10px] text-slate-400 group-hover/proj:text-slate-600 dark:group-hover/proj:text-slate-300 w-3 text-left transition-colors">
                        {open ? '▼' : '▶'}
                      </span>
                      <span
                        className="text-xs font-semibold px-1.5 py-0.5 rounded"
                        style={{ background: g.project.color + '18', color: g.project.color }}
                      >
                        {g.project.name}
                      </span>
                      <span className="text-xs text-slate-400 tabular-nums">{g.rows.length}</span>
                      {g.minutes > 0 && (
                        <span className="text-xs text-slate-300 dark:text-slate-600 font-mono">
                          {formatMinutes(g.minutes)}
                        </span>
                      )}
                      <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800" />
                    </button>
                    {open && renderTaskRows(g.rows)}
                  </div>
                  )
                })
              : renderTaskRows(topLevel)}

            {filtered.length === 0 && (
              <div className="text-center py-16 text-slate-400 text-sm">
                No tasks match your filters.
              </div>
            )}
          </div>
          )}

          {habits.length > 0 && (
            <HabitList count={habits.length}>
              {habits.map(task => (
                <HabitRow
                  key={task.id}
                  task={task}
                  streak={streaks[task.id] ?? null}
                  pending={pendingHabitIds.has(task.id)}
                  onOpen={() => setDetailTask({ ...task, project: task.project ?? INBOX_PROJECT })}
                  onDone={e => handleHabitDone(task, e)}
                  onLogTime={e => { e.stopPropagation(); setLoggingHabit(task) }}
                />
              ))}
            </HabitList>
          )}
        </div>
        )}
      </div>

      {/* Micro-reflection modal */}
      {completingTask && (
        <MicroReflection
          task={completingTask}
          onClose={() => setCompletingTask(null)}
          onDone={onReflectionDone}
        />
      )}

      {/* Task detail panel */}
      {detailTask && (
        <TaskDetail
          task={detailTask}
          projects={projects}
          streak={streaks[detailTask.id] ?? null}
          gcalWriteEnabled={gcalWriteEnabled}
          onClose={() => setDetailTask(null)}
        />
      )}

      {/* Log a habit at a specific time */}
      {loggingHabit && (
        <LogHabitModal
          habit={loggingHabit}
          gcalWriteEnabled={gcalWriteEnabled}
          onClose={() => setLoggingHabit(null)}
          onLogged={dateStr => {
            // Only a session logged for today closes out the pending row; a
            // back-filled day leaves it standing, so the card must stay.
            if (dateStr === todayStr) setDoneIds(prev => new Set([...prev, loggingHabit.id]))
            setLoggingHabit(null)
          }}
        />
      )}

      {/* Add task modal */}
      {showAddTask && (
        <AddTaskModal
          projects={projects}
          initialDueDate={addTaskDueDate}
          onClose={() => { setShowAddTask(false); setAddTaskDueDate(undefined) }}
          onCreated={() => { setShowAddTask(false); setAddTaskDueDate(undefined) }}
        />
      )}

      {/* Schedule my week preview */}
      {schedulePreview && (
        <SchedulePreviewModal
          blocks={schedulePreview.blocks}
          loading={schedulePreview.loading}
          unschedulable={schedulePreview.unschedulable}
          existing={schedulePreview.existing}
          error={schedulePreview.error}
          onClose={() => setSchedulePreview(null)}
          onConfirmed={() => setSchedulePreview(null)}
        />
      )}

    </>
  )
}
