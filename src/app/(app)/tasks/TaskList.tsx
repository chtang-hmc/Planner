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
import { TASK_LAYOUT_IMPLS } from '@/components/TaskRowLayouts'
import { CONTROL, Segmented, Toggle, HabitRow, HabitList } from '@/components/TaskChrome'
import { getStoredTaskLayout, DEFAULT_TASK_LAYOUT } from '@/lib/task-layouts'
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
}

export default function TaskList({
  tasks, projects, streaks, events, gcalWriteEnabled, weekStartDay,
  relevance = RELEVANCE_DEFAULT, todayStr,
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
  const [groupByProject, setGroupByProject] = useState(false)
  // Same trick for project sections: grouping exists to compress a long list
  // into something you can survey, so it opens compact and you expand the one
  // project you came for.
  const [openProjects, setOpenProjects] = useState<Set<string>>(new Set())
  // Which row layout to draw. localStorage can only be read in the browser, so
  // the server renders the default and the client swaps in the stored value —
  // useSyncExternalStore does that without a hydration mismatch or an effect.
  const layoutId = useStored(getStoredTaskLayout, DEFAULT_TASK_LAYOUT)
  const Layout = TASK_LAYOUT_IMPLS[layoutId]

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

  /**
   * Rows for a set of top-level tasks, each followed by its subtasks.
   *
   * The row itself is drawn by whichever layout is selected — see
   * src/lib/task-layouts.ts. This function owns which rows exist and in what
   * order; the layout owns what one looks like.
   */
  function renderTaskRows(list: TaskRow[]) {
    const rows = list.flatMap(parentTask => {
      const kids = childrenOf.get(parentTask.id) ?? []
      const isCollapsed = !expanded.has(parentTask.id)
      return (isCollapsed ? [parentTask] : [parentTask, ...kids]).map(task => ({
        task, parentTask, kids, isCollapsed,
      }))
    })

    return (
      <Layout.Shell>
        {rows.map(({ task, parentTask, kids, isCollapsed }) => (
          <Layout.Row
            key={task.id}
            task={task}
            isChild={task.id !== parentTask.id}
            kidCount={task.id === parentTask.id ? kids.length : 0}
            collapsed={isCollapsed}
            streak={streaks[task.id] ?? null}
            onToggleFold={() => setExpanded(prev => {
              const next = new Set(prev)
              if (next.has(parentTask.id)) next.delete(parentTask.id)
              else next.add(parentTask.id)
              return next
            })}
            onOpen={() => setDetailTask({ ...task, project: task.project ?? INBOX_PROJECT })}
            onDone={e => handleDone(task, e)}
          />
        ))}
      </Layout.Shell>
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
                <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">Tasks</h1>
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

                  <Toggle
                    on={relevantOnly}
                    onClick={() => setRelevantOnly(v => !v)}
                    title={relevanceHint(relevance)}
                  >
                    Relevant
                  </Toggle>
                  <Toggle on={groupByProject} onClick={() => setGroupByProject(v => !v)} title="Group the list by project">
                    By project
                  </Toggle>
                  <Toggle on={showSomeday} onClick={() => setShowSomeday(v => !v)} title="Include someday tasks">
                    Someday
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
          />
        )}

        {view === 'list' && (
        <div className="px-6 py-4">

          {/* Task rows */}
          <div className="flex flex-col gap-1.5">
            {groupByProject && projectGroups
              ? projectGroups.map(g => {
                  const open = openProjects.has(g.key)
                  return (
                  <div key={g.key} className={`flex flex-col ${Layout.groupGap}`}>
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
