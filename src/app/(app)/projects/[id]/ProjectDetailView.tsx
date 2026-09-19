'use client'

import { useState } from 'react'
import { EnergyIcon, EditIcon, ArchiveIcon } from '@/components/icons'
import { Flame } from 'lucide-react'
import Link from 'next/link'
import { Task, Project, EstimationProfile, HabitStreak } from '@/types'

function priorityCircleClass(priority: 1 | 2 | 3 | 4) {
  switch (priority) {
    case 4: return 'border-red-400    bg-red-50    dark:bg-red-950/40    hover:bg-red-100    dark:hover:bg-red-900/50'
    case 3: return 'border-orange-400 bg-orange-50 dark:bg-orange-950/40 hover:bg-orange-100 dark:hover:bg-orange-900/50'
    case 2: return 'border-blue-400   bg-blue-50   dark:bg-blue-950/40   hover:bg-blue-100   dark:hover:bg-blue-900/50'
    case 1: return 'border-slate-200  bg-white     dark:bg-slate-900     dark:border-slate-700 hover:border-accent-400 hover:bg-accent-50 dark:hover:bg-accent-950'
  }
}
import { completeTask } from '@/app/actions/tasks'
import { archiveProject } from '@/app/actions/projects'
import { rruleToLabel } from '@/lib/rrule-utils'
import TaskDetail from '@/components/TaskDetail'
import MicroReflection from '@/components/MicroReflection'
import AddTaskModal from '@/components/AddTaskModal'
import ProjectModal from '@/components/ProjectModal'

// ── Helpers ───────────────────────────────────────────────────────────────────


function fmt(m: number | null) {
  if (!m) return '—'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60), r = m % 60
  return r ? `${h}h ${r}m` : `${h}h`
}

function dueLabel(iso: string | null): { text: string; cls: string } {
  if (!iso) return { text: '', cls: '' }
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
  if (diff < 0)  return { text: 'Overdue',  cls: 'text-red-500 font-semibold' }
  if (diff === 0) return { text: 'Today',    cls: 'text-red-500 font-semibold' }
  if (diff === 1) return { text: 'Tomorrow', cls: 'text-amber-500' }
  return { text: `${diff}d`, cls: 'text-slate-400' }
}

function urgencyBar(score: number) {
  if (score >= 70) return '#ef4444'
  if (score >= 40) return '#f59e0b'
  return '#e2e8f0'
}

function BiasChip({ bias }: { bias: EstimationProfile }) {
  const { bias_ratio: r, sample_count: n } = bias
  if (n < 3) return <span className="text-xs text-slate-400 italic">Need {3 - n} more sample{3 - n !== 1 ? 's' : ''} for bias estimate</span>
  const pct  = Math.abs(Math.round((r - 1) * 100))
  const diff = Math.abs(r - 1)
  const color = diff < 0.12 ? 'text-accent-600 dark:text-accent-400 bg-accent-50 dark:bg-accent-950 border-accent-200 dark:border-accent-800'
    : diff < 0.35 ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800'
    : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800'
  const label = diff < 0.05 ? '✓ Estimating accurately'
    : r > 1 ? `↑ ${pct}% over estimate (takes longer than expected)`
    : `↓ ${pct}% under estimate (finishes faster than expected)`
  return <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${color}`}>{label}</span>
}

// ── Task row (active) ─────────────────────────────────────────────────────────

interface TaskRowProps {
  task: Task & { project: Project }
  streak?: HabitStreak
  onDone: (e: React.MouseEvent) => void
  onClick: () => void
  pendingDone?: boolean
}

function ActiveTaskRow({ task, streak, onDone, onClick, pendingDone }: TaskRowProps) {
  const est = task.adjusted_minutes ?? task.estimated_minutes
  const due = dueLabel(task.due_date)
  const isHabit = task.type === 'habit'

  return (
    <div
      onClick={onClick}
      className={`group flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors border-b border-slate-100 dark:border-slate-800 last:border-0 ${
        isHabit ? 'bg-violet-50/30 dark:bg-violet-950/10' : ''
      }`}
    >
      {/* Urgency bar */}
      <div className="w-0.5 h-7 rounded-full shrink-0" style={{ background: urgencyBar(task.urgency_score) }} />

      {/* Done button */}
      <button
        onClick={onDone}
        disabled={pendingDone}
        className={`shrink-0 rounded-full border-2 transition-all mt-0.5 flex items-center justify-center ${
          isHabit
            ? 'w-5 h-5 border-violet-300 dark:border-violet-700 hover:bg-violet-500 hover:border-violet-500'
            : `w-4 h-4 ${priorityCircleClass(task.priority)}`
        } ${pendingDone ? 'opacity-40' : ''}`}
        title={isHabit ? 'Log habit' : 'Complete task'}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-snug">{task.title}</span>
          {isHabit && (
            <span className="text-xs text-violet-500 dark:text-violet-400 bg-violet-50 dark:bg-violet-950 px-1.5 py-0.5 rounded font-medium">
              habit
            </span>
          )}
          {task.type === 'recurring' && (
            <span className="text-xs text-violet-400">↻</span>
          )}
          {task.type === 'someday' && (
            <span className="text-xs text-amber-500 bg-amber-50 dark:bg-amber-950 px-1.5 py-0.5 rounded font-medium">someday</span>
          )}
        </div>
        <div className="flex items-center gap-2.5 mt-0.5 flex-wrap">
          <EnergyIcon level={task.energy_required} className="text-slate-400" />
          {est && <span className="text-xs text-slate-400 font-mono">{fmt(est)}</span>}
          {due.text && <span className={`text-xs ${due.cls}`}>{due.text}</span>}
          {isHabit && task.rrule && (
            <span className="text-xs text-violet-400">{rruleToLabel(task.rrule)}</span>
          )}
        </div>
      </div>

      {/* Streak (habits) or urgency score */}
      <div className="shrink-0 text-right">
        {isHabit && streak && streak.current_streak > 0 ? (
          <div className="flex items-baseline gap-0.5">
            <span className="text-base font-bold font-mono text-violet-500 dark:text-violet-400 leading-none tabular-nums">
              {streak.current_streak}
            </span>
            {streak.current_streak >= 7 && <Flame size={13} className="text-orange-500" />}
          </div>
        ) : (
          <span className={`text-xs font-semibold font-mono tabular-nums ${
            task.urgency_score >= 70 ? 'text-red-500' : task.urgency_score >= 40 ? 'text-amber-500' : 'text-slate-300 dark:text-slate-600'
          }`}>
            {Math.round(task.urgency_score)}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Done task row ─────────────────────────────────────────────────────────────

function DoneTaskRow({ task }: { task: Task }) {
  const actual   = task.actual_minutes
  const estimate = task.estimated_minutes
  const completedDate = task.completed_at
    ? new Date(task.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 last:border-0 opacity-60">
      <span className="text-accent-500 text-xs shrink-0">✓</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-600 dark:text-slate-400 line-through leading-snug truncate">{task.title}</p>
      </div>
      <div className="shrink-0 flex items-center gap-2 text-xs text-slate-400 font-mono">
        {actual && estimate && (
          <span title="actual vs estimate">
            {fmt(actual)}/{fmt(estimate)}
          </span>
        )}
        {completedDate && <span className="text-slate-300 dark:text-slate-600">{completedDate}</span>}
      </div>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

interface Props {
  project:          Project
  activeTasks:      (Task & { project: Project })[]
  doneTasks:        Task[]
  allProjects:      Project[]
  bias:             EstimationProfile | null
  streaks:          Record<string, HabitStreak>
  gcalWriteEnabled: boolean
}

export default function ProjectDetailView({
  project, activeTasks, doneTasks, allProjects, bias, streaks, gcalWriteEnabled,
}: Props) {
  const [detailTask,      setDetailTask]      = useState<(Task & { project: Project }) | null>(null)
  const [completingTask,  setCompletingTask]  = useState<(Task & { project: Project }) | null>(null)
  const [doneIds,         setDoneIds]         = useState<Set<string>>(new Set())
  const [pendingHabits,   setPendingHabits]   = useState<Set<string>>(new Set())
  const [showAdd,         setShowAdd]         = useState(false)
  const [showEdit,        setShowEdit]        = useState(false)
  const [archiving,       setArchiving]       = useState(false)
  const [tab,             setTab]             = useState<'active' | 'done'>('active')

  // Stats
  const habits  = activeTasks.filter(t => t.type === 'habit' && !doneIds.has(t.id))
  const regular = activeTasks.filter(t => t.type !== 'habit' && !doneIds.has(t.id))
  const totalActive = regular.length + habits.length
  const totalDone   = doneTasks.length + doneIds.size
  const totalAll    = totalActive + totalDone
  const pct         = totalAll > 0 ? Math.round((totalDone / totalAll) * 100) : 0
  const totalEst    = regular.reduce((s, t) => s + (t.adjusted_minutes ?? t.estimated_minutes ?? 0), 0)

  function handleDone(task: Task & { project: Project }, e: React.MouseEvent) {
    e.stopPropagation()
    setCompletingTask(task)
  }

  async function handleHabitDone(task: Task & { project: Project }, e: React.MouseEvent) {
    e.stopPropagation()
    if (pendingHabits.has(task.id)) return
    setPendingHabits(p => new Set([...p, task.id]))
    try {
      await completeTask(task.id, null, null, null)
      setDoneIds(p => new Set([...p, task.id]))
    } finally {
      setPendingHabits(p => { const n = new Set(p); n.delete(task.id); return n })
    }
  }

  async function handleArchive() {
    if (!confirm(`Archive "${project.name}"? Its tasks and history are kept.`)) return
    setArchiving(true)
    try { await archiveProject(project.id) } finally { setArchiving(false) }
  }

  return (
    <>
      <div className="min-h-full bg-slate-50 dark:bg-slate-950">

        {/* ── Sticky header ── */}
        <header className="sticky top-0 z-10 bg-white/90 dark:bg-slate-900/90 backdrop-blur border-b border-slate-200 dark:border-slate-800">
          <div className="px-6 py-4">
            {/* Breadcrumb */}
            <p className="text-xs text-slate-400 mb-2">
              <Link href="/projects" className="hover:text-slate-600 dark:hover:text-slate-300 transition-colors">Projects</Link>
              <span className="mx-1.5">›</span>
              <span>{project.name}</span>
            </p>

            {/* Title row */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-4 h-4 rounded-full shrink-0" style={{ background: project.color }} />
                <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 truncate">{project.name}</h1>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setShowEdit(true)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  <span className="flex items-center gap-2"><EditIcon size={12} /> Edit</span>
                </button>
                <button
                  onClick={handleArchive}
                  disabled={archiving}
                  className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors disabled:opacity-50"
                >
                  <span className="flex items-center gap-2"><ArchiveIcon size={12} /> Archive</span>
                </button>
                <button
                  onClick={() => setShowAdd(true)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-medium hover:opacity-80 transition-opacity"
                >
                  + Add task
                </button>
              </div>
            </div>
          </div>
        </header>

        <div className="px-6 py-5 flex flex-col gap-6">

          {/* ── Stats ── */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 flex flex-col gap-4">
            {/* Numbers */}
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: 'Active',     value: totalActive },
                { label: 'Done',       value: totalDone },
                { label: 'Complete',   value: totalAll > 0 ? `${pct}%` : '—' },
                { label: 'Est. left',  value: totalEst > 0 ? fmt(totalEst) : '—' },
              ].map(s => (
                <div key={s.label} className="text-center">
                  <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums leading-tight">{s.value}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Progress bar */}
            {totalAll > 0 && (
              <div>
                <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, background: project.color }}
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1.5 text-right">{totalDone} of {totalAll} tasks complete</p>
              </div>
            )}

            {/* Bias */}
            {bias && <BiasChip bias={bias} />}
          </div>

          {/* ── Tabs ── */}
          <div className="flex items-center gap-0.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-1 w-fit">
            {([
              { id: 'active', label: `Active (${totalActive})` },
              { id: 'done',   label: `Done (${totalDone})` },
            ] as const).map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Active tasks ── */}
          {tab === 'active' && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              {regular.length === 0 && habits.length === 0 ? (
                <div className="text-center py-14 flex flex-col items-center gap-3">
                  <p className="text-3xl">✓</p>
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">All clear!</p>
                  <p className="text-xs text-slate-400">No active tasks in this project.</p>
                  <button
                    onClick={() => setShowAdd(true)}
                    className="mt-1 text-xs text-accent-600 dark:text-accent-400 hover:underline"
                  >
                    + Add a task
                  </button>
                </div>
              ) : (
                <>
                  {/* Regular tasks */}
                  {regular.map(task => (
                    <ActiveTaskRow
                      key={task.id}
                      task={task}
                      onDone={e => handleDone(task, e)}
                      onClick={() => setDetailTask({ ...task, project })}
                    />
                  ))}

                  {/* Habits divider */}
                  {habits.length > 0 && regular.length > 0 && (
                    <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/50 border-y border-slate-100 dark:border-slate-800">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Habits</span>
                    </div>
                  )}
                  {habits.length > 0 && habits.length === totalActive && (
                    <div className="px-4 py-2 bg-violet-50/50 dark:bg-violet-950/20 border-b border-violet-100 dark:border-violet-900/30">
                      <span className="text-xs font-semibold uppercase tracking-wider text-violet-400">Habits</span>
                    </div>
                  )}

                  {/* Habit rows */}
                  {habits.map(task => (
                    <ActiveTaskRow
                      key={task.id}
                      task={task}
                      streak={streaks[task.id]}
                      onDone={e => handleHabitDone(task, e)}
                      onClick={() => setDetailTask({ ...task, project })}
                      pendingDone={pendingHabits.has(task.id)}
                    />
                  ))}

                  {/* Add task row */}
                  <button
                    onClick={() => setShowAdd(true)}
                    className="w-full flex items-center gap-2 px-4 py-3 text-xs text-slate-400 hover:text-accent-600 dark:hover:text-accent-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border-t border-slate-100 dark:border-slate-800"
                  >
                    <span className="text-base leading-none">+</span> Add task to {project.name}
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── Done tasks ── */}
          {tab === 'done' && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              {doneTasks.length === 0 && doneIds.size === 0 ? (
                <p className="text-sm text-slate-400 text-center py-12 italic">No completed tasks yet.</p>
              ) : (
                doneTasks.map(task => <DoneTaskRow key={task.id} task={task} />)
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {detailTask && (
        <TaskDetail
          task={detailTask}
          projects={allProjects}
          streak={streaks[detailTask.id] ?? null}
          gcalWriteEnabled={gcalWriteEnabled}
          onClose={() => setDetailTask(null)}
        />
      )}

      {completingTask && (
        <MicroReflection
          task={completingTask}
          onClose={() => setCompletingTask(null)}
          onDone={() => {
            if (completingTask) setDoneIds(p => new Set([...p, completingTask.id]))
            setCompletingTask(null)
          }}
        />
      )}

      {showAdd && (
        <AddTaskModal
          projects={allProjects}
          initialProjectId={project.id}
          onClose={() => setShowAdd(false)}
          onCreated={() => setShowAdd(false)}
        />
      )}

      {showEdit && (
        <ProjectModal
          project={project}
          onClose={() => setShowEdit(false)}
        />
      )}
    </>
  )
}
