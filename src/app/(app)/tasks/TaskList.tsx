'use client'

import { useState, useTransition } from 'react'
import { Task, Project, EnergyLevel, HabitStreak, CalendarEvent, INBOX_PROJECT } from '@/types'
import { useSearch } from '@/contexts/SearchContext'
import { getStoredDefaultView } from '@/app/(app)/settings/SettingsView'
import { completeTask } from '@/app/actions/tasks'
import { proposeSchedule, planDay } from '@/app/actions/scheduling'
import type { SchedulerTask } from '@/lib/scheduler'
import { rruleToLabel } from '@/lib/rrule-utils'
import MicroReflection from '@/components/MicroReflection'
import TaskDetail from '@/components/TaskDetail'
import AddTaskModal from '@/components/AddTaskModal'
import SchedulePreviewModal, { type PreviewBlock } from '@/components/SchedulePreviewModal'
import DayPlanModal from '@/components/DayPlanModal'
import UpcomingView from './UpcomingView'

const ENERGY_ICON: Record<EnergyLevel, string> = { low: '🌿', medium: '⚡', high: '🔥' }
const CURVE_ICON = { linear: '╱', exponential: '⌒', step: '⌐' }

function urgencyColor(score: number) {
  if (score >= 70) return 'text-red-500 dark:text-red-400'
  if (score >= 40) return 'text-amber-500 dark:text-amber-400'
  return 'text-slate-300 dark:text-slate-600'
}

/** Priority circle: colored border + subtle fill, white for low */
function priorityCircleClass(priority: 1 | 2 | 3 | 4) {
  switch (priority) {
    case 4: return 'border-red-400    bg-red-50    dark:bg-red-950/40    hover:bg-red-100    dark:hover:bg-red-900/50'
    case 3: return 'border-orange-400 bg-orange-50 dark:bg-orange-950/40 hover:bg-orange-100 dark:hover:bg-orange-900/50'
    case 2: return 'border-blue-400   bg-blue-50   dark:bg-blue-950/40   hover:bg-blue-100   dark:hover:bg-blue-900/50'
    case 1: return 'border-slate-200  bg-white     dark:bg-slate-900     dark:border-slate-700 hover:border-accent-400 hover:bg-accent-50 dark:hover:bg-accent-950'
  }
}

function formatMinutes(m: number | null): string {
  if (!m) return '—'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60), rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

function formatDue(iso: string | null): { label: string; urgent: boolean } {
  if (!iso) return { label: '', urgent: false }
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
  if (diff < 0)  return { label: 'Overdue', urgent: true }
  if (diff === 0) return { label: 'Today',   urgent: true }
  if (diff === 1) return { label: 'Tomorrow', urgent: false }
  return { label: `${diff}d`, urgent: false }
}

interface Props {
  tasks: (Task & { project: Project })[]
  projects: Project[]
  streaks: Record<string, HabitStreak>
  events: CalendarEvent[]
  gcalWriteEnabled: boolean
}

export default function TaskList({ tasks, projects, streaks, events, gcalWriteEnabled }: Props) {
  const { query } = useSearch()
  const [view, setView] = useState<'list' | 'upcoming'>(() =>
    typeof window !== 'undefined' ? getStoredDefaultView() : 'list'
  )
  const [energyFilter, setEnergyFilter]   = useState<EnergyLevel | 'all'>('all')
  const [projectFilter, setProjectFilter] = useState<string>('all')
  const [showSomeday, setShowSomeday]     = useState(false)

  // Completing a regular task (opens MicroReflection)
  const [completingTask, setCompletingTask] = useState<(Task & { project: Project }) | null>(null)
  const [doneIds, setDoneIds]               = useState<Set<string>>(new Set())

  // Completing a habit (instant — no reflection)
  const [pendingHabitIds, setPendingHabitIds] = useState<Set<string>>(new Set())

  // Task detail
  const [detailTask, setDetailTask] = useState<(Task & { project: Project }) | null>(null)

  // Add task modal
  const [showAddTask, setShowAddTask]       = useState(false)
  const [addTaskDueDate, setAddTaskDueDate] = useState<string | undefined>(undefined)

  // Scheduling modals
  const [schedulePreview, setSchedulePreview] = useState<{
    blocks: PreviewBlock[]; unschedulable: SchedulerTask[]
  } | null>(null)
  const [dayPlan, setDayPlan] = useState<{
    blocks: PreviewBlock[]; attackList: Parameters<typeof DayPlanModal>[0]['attackList']; unschedulable: SchedulerTask[]
  } | null>(null)
  const [scheduling, setScheduling] = useState(false)
  const [, startTransition] = useTransition()

  function handleScheduleWeek() {
    if (!gcalWriteEnabled) return
    setScheduling(true)
    startTransition(async () => {
      const res = await proposeSchedule(7)
      setSchedulePreview({
        blocks: res.scheduled.map(b => ({
          taskId: b.taskId, taskTitle: b.taskTitle, taskPriority: b.taskPriority,
          startISO: b.startISO, endISO: b.endISO,
          segmentIndex: b.segmentIndex, totalSegments: b.totalSegments, energyMatch: b.energyMatch,
        })),
        unschedulable: res.unschedulable,
      })
      setScheduling(false)
    })
  }

  function handlePlanDay() {
    if (!gcalWriteEnabled) return
    setScheduling(true)
    startTransition(async () => {
      const res = await planDay()
      setDayPlan({
        blocks: res.proposedBlocks.map(b => ({
          taskId: b.taskId, taskTitle: b.taskTitle, taskPriority: b.taskPriority,
          startISO: b.startISO, endISO: b.endISO,
          segmentIndex: b.segmentIndex, totalSegments: b.totalSegments, energyMatch: b.energyMatch,
        })),
        attackList: res.attackList,
        unschedulable: res.unschedulable,
      })
      setScheduling(false)
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

  // Split habits from regular tasks
  const habits  = tasks.filter(t => t.type === 'habit' && !doneIds.has(t.id) && matchesSearch(t))
  const filtered = tasks.filter(t => {
    if (t.type === 'habit') return false          // habits have their own section
    if (doneIds.has(t.id)) return false
    if (!showSomeday && t.type === 'someday') return false
    if (energyFilter !== 'all' && t.energy_required !== energyFilter) return false
    if (projectFilter !== 'all' && t.project_id !== projectFilter) return false
    if (!matchesSearch(t)) return false
    return true
  })

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

  return (
    <>
      <div className="min-h-full bg-slate-50 dark:bg-slate-950">
        {/* Top bar */}
        <header className="sticky top-0 z-10 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur">
          <div className="px-6 py-3 flex items-center justify-between gap-3">
            {/* View toggle */}
            <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
              <button
                onClick={() => setView('list')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  view === 'list'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                ☰ List
              </button>
              <button
                onClick={() => setView('upcoming')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  view === 'upcoming'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                📅 Upcoming
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs">
              {view === 'list' && (
                <span className="text-slate-400 tabular-nums hidden sm:inline">
                  {filtered.length} tasks · {formatMinutes(totalMinutes)}
                </span>
              )}
              {gcalWriteEnabled && (
                <>
                  <button
                    onClick={handlePlanDay}
                    disabled={scheduling}
                    title="Plan my day — rank and schedule today's tasks"
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:border-accent-400 hover:text-accent-600 dark:hover:text-accent-400 disabled:opacity-40 transition-colors font-medium"
                  >
                    {scheduling ? '…' : '📋 Plan day'}
                  </button>
                  <button
                    onClick={handleScheduleWeek}
                    disabled={scheduling}
                    title="Schedule my week — auto-fill the week with your tasks"
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:border-accent-400 hover:text-accent-600 dark:hover:text-accent-400 disabled:opacity-40 transition-colors font-medium"
                  >
                    {scheduling ? '…' : '🗓 Schedule week'}
                  </button>
                </>
              )}
              <button
                onClick={() => openAddTask()}
                className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-3 py-1.5 rounded-lg font-medium hover:opacity-80 transition-opacity"
              >
                + Add task
              </button>
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
          />
        )}

        {view === 'list' && (
        <div className="px-6 py-4">
          {/* Filters */}
          <div className="flex items-center gap-2 mb-5 flex-wrap">
            <div className="flex items-center gap-0.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-0.5">
              {(['all', 'low', 'medium', 'high'] as const).map(e => (
                <button
                  key={e}
                  onClick={() => setEnergyFilter(e)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    energyFilter === e
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {e === 'all' ? 'All energy' : `${ENERGY_ICON[e]} ${e}`}
                </button>
              ))}
            </div>

            <select
              value={projectFilter}
              onChange={e => setProjectFilter(e.target.value)}
              className="text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-600 dark:text-slate-300 font-medium focus:outline-none"
            >
              <option value="all">All projects</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>

            <button
              onClick={() => setShowSomeday(v => !v)}
              className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors ${
                showSomeday
                  ? 'bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500'
              }`}
            >
              📦 Someday
            </button>
          </div>

          {/* Task rows */}
          <div className="flex flex-col gap-1.5">
            {filtered.map(task => {
              const est = task.adjusted_minutes ?? task.estimated_minutes
              const due = formatDue(task.due_date)

              return (
                <div
                  key={task.id}
                  onClick={() => setDetailTask({ ...task, project: task.project ?? INBOX_PROJECT })}
                  className="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 flex items-center gap-3 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-sm transition-all cursor-pointer"
                >
                  {/* Done button — colored by priority */}
                  <button
                    onClick={e => handleDone(task, e)}
                    className={`w-4 h-4 rounded-full border-2 shrink-0 transition-all mt-0.5 ${priorityCircleClass(task.priority)}`}
                    title="Mark done"
                  />

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-snug">{task.title}</span>
                      {task.type === 'someday' && (
                        <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 px-1.5 py-0.5 rounded font-medium">someday</span>
                      )}
                      {task.type === 'recurring' && (() => {
                        const streak = streaks[task.id]
                        return (
                          <span className="text-xs text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950 px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
                            ↻{streak && streak.current_streak > 0 && (
                              <span className="ml-0.5">{streak.current_streak >= 7 ? '🔥' : '·'}{streak.current_streak}</span>
                            )}
                          </span>
                        )
                      })()}
                    </div>
                    <div className="flex items-center gap-2.5 mt-0.5 flex-wrap">
                      {(() => {
                        const proj = task.project ?? INBOX_PROJECT
                        return (
                          <span
                            className="text-xs font-medium px-1.5 py-0.5 rounded"
                            style={{ background: proj.color + '18', color: proj.color }}
                          >
                            {proj.name}
                          </span>
                        )
                      })()}
                      <span className="text-xs text-slate-400">{ENERGY_ICON[task.energy_required]}</span>
                      {est && <span className="text-xs text-slate-400 font-mono">{formatMinutes(est)}</span>}
                      {due.label && (
                        <span className={`text-xs font-medium ${due.urgent ? 'text-red-500' : 'text-slate-400'}`}>
                          {due.urgent && due.label !== 'Today' ? '⚠ ' : ''}{due.label}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Urgency */}
                  <div className="shrink-0 text-right">
                    <span className={`text-xs font-semibold font-mono tabular-nums ${urgencyColor(task.urgency_score)}`}>
                      {Math.round(task.urgency_score)}
                    </span>
                    <div className={`text-xs font-mono opacity-50 ${urgencyColor(task.urgency_score)}`}>
                      {CURVE_ICON[task.urgency_curve]}
                    </div>
                  </div>
                </div>
              )
            })}

            {filtered.length === 0 && (
              <div className="text-center py-16 text-slate-400 text-sm">
                No tasks match your filters.
              </div>
            )}
          </div>

          {/* ── Habits section ── */}
          {habits.length > 0 && (
            <div className="mt-6">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
                Habits
              </h2>
              <div className="flex flex-col gap-1.5">
                {habits.map(task => {
                  const streak = streaks[task.id]
                  const isPending = pendingHabitIds.has(task.id)
                  return (
                    <div
                      key={task.id}
                      onClick={() => setDetailTask({ ...task, project: task.project ?? INBOX_PROJECT })}
                      className="group bg-white dark:bg-slate-900 border border-violet-100 dark:border-violet-900/50 rounded-xl px-4 py-3 flex items-center gap-3 hover:border-violet-200 dark:hover:border-violet-800 hover:shadow-sm transition-all cursor-pointer"
                    >
                      {/* One-tap done button */}
                      <button
                        onClick={e => handleHabitDone(task, e)}
                        disabled={isPending}
                        className={`w-5 h-5 rounded-full border-2 shrink-0 transition-all mt-0.5 flex items-center justify-center ${
                          isPending
                            ? 'border-violet-300 dark:border-violet-700 bg-violet-100 dark:bg-violet-900'
                            : 'border-violet-300 dark:border-violet-700 hover:bg-violet-500 hover:border-violet-500'
                        }`}
                        title="Log habit"
                      >
                        {isPending && <span className="text-violet-500 text-xs">…</span>}
                      </button>

                      {/* Name + frequency */}
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{task.title}</span>
                        {task.rrule && (
                          <p className="text-xs text-violet-400 dark:text-violet-500 mt-0.5">{rruleToLabel(task.rrule)}</p>
                        )}
                      </div>

                      {/* Streak */}
                      <div className="shrink-0 text-right">
                        {streak && streak.current_streak > 0 ? (
                          <>
                            <div className="flex items-baseline gap-0.5 justify-end">
                              <span className="text-lg font-bold font-mono tabular-nums text-violet-600 dark:text-violet-400 leading-none">
                                {streak.current_streak}
                              </span>
                              {streak.current_streak >= 7 && <span className="text-sm">🔥</span>}
                            </div>
                            <p className="text-xs text-violet-400 dark:text-violet-500">
                              {streak.current_streak === 1 ? 'day' : 'days'}
                            </p>
                          </>
                        ) : (
                          <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
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
          unschedulable={schedulePreview.unschedulable}
          onClose={() => setSchedulePreview(null)}
          onConfirmed={() => setSchedulePreview(null)}
        />
      )}

      {/* Plan my day */}
      {dayPlan && (
        <DayPlanModal
          proposedBlocks={dayPlan.blocks}
          attackList={dayPlan.attackList}
          unschedulable={dayPlan.unschedulable}
          onClose={() => setDayPlan(null)}
          onConfirmed={() => setDayPlan(null)}
        />
      )}
    </>
  )
}
