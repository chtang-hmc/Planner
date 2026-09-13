'use client'

import { useState } from 'react'
import { Task, Project, EnergyLevel } from '@/types'
import MicroReflection from '@/components/MicroReflection'
import TaskDetail from '@/components/TaskDetail'

const ENERGY_ICON: Record<EnergyLevel, string> = { low: '🌿', medium: '⚡', high: '🔥' }
const CURVE_ICON = { linear: '╱', exponential: '⌒', step: '⌐' }

function urgencyColor(score: number) {
  if (score >= 70) return 'text-red-500 dark:text-red-400'
  if (score >= 40) return 'text-amber-500 dark:text-amber-400'
  return 'text-slate-300 dark:text-slate-600'
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
}

export default function TaskList({ tasks, projects }: Props) {
  const [energyFilter, setEnergyFilter]   = useState<EnergyLevel | 'all'>('all')
  const [projectFilter, setProjectFilter] = useState<string>('all')
  const [showSomeday, setShowSomeday]     = useState(false)

  // Completing a task
  const [completingTask, setCompletingTask] = useState<(Task & { project: Project }) | null>(null)
  const [doneIds, setDoneIds]               = useState<Set<string>>(new Set())

  // Task detail
  const [detailTask, setDetailTask] = useState<(Task & { project: Project }) | null>(null)

  const filtered = tasks.filter(t => {
    if (doneIds.has(t.id)) return false
    if (!showSomeday && t.type === 'someday') return false
    if (energyFilter !== 'all' && t.energy_required !== energyFilter) return false
    if (projectFilter !== 'all' && t.project_id !== projectFilter) return false
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

  return (
    <>
      <div className="min-h-full bg-slate-50 dark:bg-slate-950">
        {/* Top bar */}
        <header className="sticky top-0 z-10 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur">
          <div className="px-6 py-3 flex items-center justify-between gap-3">
            <h1 className="font-semibold text-sm text-slate-900 dark:text-slate-100">All Tasks</h1>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-slate-400 tabular-nums">
                {filtered.length} tasks · {formatMinutes(totalMinutes)}
              </span>
              <button className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-3 py-1.5 rounded-lg font-medium hover:opacity-80 transition-opacity text-xs">
                + Add task
              </button>
            </div>
          </div>
        </header>

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
                  onClick={() => setDetailTask(task)}
                  className="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 flex items-center gap-3 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-sm transition-all cursor-pointer"
                >
                  {/* Done button */}
                  <button
                    onClick={e => handleDone(task, e)}
                    className="w-4 h-4 rounded-full border-2 border-slate-200 dark:border-slate-700 shrink-0 hover:border-teal-500 dark:hover:border-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950 transition-all mt-0.5"
                    title="Mark done"
                  />

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-snug">{task.title}</span>
                      {task.type === 'someday' && (
                        <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 px-1.5 py-0.5 rounded font-medium">someday</span>
                      )}
                      {task.type === 'recurring' && (
                        <span className="text-xs text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950 px-1.5 py-0.5 rounded font-medium">↻</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2.5 mt-0.5 flex-wrap">
                      <span
                        className="text-xs font-medium px-1.5 py-0.5 rounded"
                        style={{ background: task.project.color + '18', color: task.project.color }}
                      >
                        {task.project.name}
                      </span>
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
        </div>
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
          onClose={() => setDetailTask(null)}
        />
      )}
    </>
  )
}
