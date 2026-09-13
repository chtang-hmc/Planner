'use client'

import { useState } from 'react'
import { Task, Project, EnergyLevel, INBOX_PROJECT } from '@/types'
import { ProjectData } from './page'
import TaskDetail from '@/components/TaskDetail'
import AddTaskModal from '@/components/AddTaskModal'

// ── helpers ──────────────────────────────────────────────────────────────────

const ENERGY_ICON: Record<EnergyLevel, string> = { low: '🌿', medium: '⚡', high: '🔥' }

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

function urgencyColor(score: number) {
  if (score >= 70) return 'text-red-500'
  if (score >= 40) return 'text-amber-500'
  return 'text-slate-300 dark:text-slate-600'
}

// Bias display: ratio of 1.3 → "30% over", 0.8 → "20% under"
function BiasChip({ ratio, samples }: { ratio: number; samples: number }) {
  if (samples < 3) {
    return (
      <span className="text-xs text-slate-400 italic">
        Bias: need {3 - samples} more sample{3 - samples !== 1 ? 's' : ''}
      </span>
    )
  }

  const pct = Math.abs(Math.round((ratio - 1) * 100))
  const over = ratio > 1
  const color =
    Math.abs(ratio - 1) < 0.12
      ? 'text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950 border-teal-200 dark:border-teal-800'
      : Math.abs(ratio - 1) < 0.35
      ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800'
      : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800'

  const label =
    Math.abs(ratio - 1) < 0.05
      ? '✓ Estimating accurately'
      : over
      ? `↑ ${pct}% over estimate`
      : `↓ ${pct}% under estimate`

  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${color}`}>
      {label}
    </span>
  )
}

// ── ProjectCard ──────────────────────────────────────────────────────────────

interface CardProps {
  pd: ProjectData
  allProjects: Project[]
  onSelectTask: (task: Task & { project: Project }) => void
  onAddTask: (projectId: string) => void
}

function ProjectCard({ pd, allProjects, onSelectTask, onAddTask }: CardProps) {
  const [collapsed, setCollapsed] = useState(false)

  const { project, activeTasks, doneCount, bias } = pd
  const totalEst = activeTasks.reduce(
    (s, t) => s + (t.adjusted_minutes ?? t.estimated_minutes ?? 0),
    0
  )
  const totalCount = activeTasks.length + doneCount

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
      {/* Project header */}
      <div
        className="px-5 py-4 flex items-start justify-between cursor-pointer select-none hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        onClick={() => setCollapsed(v => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-3 h-3 rounded-full shrink-0 mt-0.5"
            style={{ background: project.color }}
          />
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {project.name}
            </h2>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs text-slate-400">
                {activeTasks.length} active · {doneCount} done
                {totalCount > 0 && (
                  <> · {Math.round((doneCount / totalCount) * 100)}% complete</>
                )}
              </span>
              {totalEst > 0 && (
                <span className="text-xs text-slate-400 font-mono">
                  {formatMinutes(totalEst)} remaining
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0 ml-3">
          {bias && (
            <BiasChip ratio={bias.bias_ratio} samples={bias.sample_count} />
          )}
          <span className="text-slate-400 text-sm">{collapsed ? '›' : '⌄'}</span>
        </div>
      </div>

      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="px-5 pb-0">
          <div className="h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.round((doneCount / totalCount) * 100)}%`,
                background: project.color,
              }}
            />
          </div>
        </div>
      )}

      {/* Task list */}
      {!collapsed && (
        <div className="px-3 py-3">
          {activeTasks.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4 italic">
              No active tasks — all clear ✓
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {activeTasks.map(task => {
                const est = task.adjusted_minutes ?? task.estimated_minutes
                const due = formatDue(task.due_date)

                return (
                  <div
                    key={task.id}
                    onClick={() => onSelectTask({ ...task, project: task.project ?? INBOX_PROJECT })}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors group"
                  >
                    {/* Urgency bar */}
                    <div className="w-0.5 h-6 rounded-full shrink-0" style={{
                      background: task.urgency_score >= 70 ? '#ef4444'
                        : task.urgency_score >= 40 ? '#f59e0b'
                        : '#e2e8f0',
                    }} />

                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-800 dark:text-slate-200 font-medium leading-snug truncate">
                        {task.title}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-slate-400">{ENERGY_ICON[task.energy_required]}</span>
                        {est && <span className="text-xs text-slate-400 font-mono">{formatMinutes(est)}</span>}
                        {due.label && (
                          <span className={`text-xs font-medium ${due.urgent ? 'text-red-500' : 'text-slate-400'}`}>
                            {due.label}
                          </span>
                        )}
                      </div>
                    </div>

                    <span className={`text-xs font-semibold font-mono tabular-nums shrink-0 ${urgencyColor(task.urgency_score)}`}>
                      {Math.round(task.urgency_score)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Add task button */}
          <button
            onClick={e => { e.stopPropagation(); onAddTask(project.id) }}
            className="w-full mt-2 py-2 text-xs text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950 rounded-xl transition-colors font-medium"
          >
            + Add task to {project.name}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main view ────────────────────────────────────────────────────────────────

interface Props {
  projectDataList: ProjectData[]
  allProjects: Project[]
}

export default function ProjectsView({ projectDataList, allProjects }: Props) {
  const [detailTask, setDetailTask] = useState<(Task & { project: Project }) | null>(null)
  const [addTaskProjectId, setAddTaskProjectId] = useState<string | null>(null)

  const totalActive = projectDataList.reduce((s, pd) => s + pd.activeTasks.length, 0)
  const totalDone   = projectDataList.reduce((s, pd) => s + pd.doneCount, 0)

  return (
    <>
      <div className="min-h-full bg-slate-50 dark:bg-slate-950">
        {/* Header */}
        <header className="sticky top-0 z-10 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur">
          <div className="px-6 py-3 flex items-center justify-between">
            <h1 className="font-semibold text-sm text-slate-900 dark:text-slate-100">Projects</h1>
            <span className="text-xs text-slate-400 tabular-nums">
              {projectDataList.length} projects · {totalActive} active · {totalDone} done
            </span>
          </div>
        </header>

        {/* Cards */}
        <div className="px-6 py-5 flex flex-col gap-4 max-w-2xl">
          {projectDataList.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-16">No projects yet.</p>
          ) : (
            projectDataList.map(pd => (
              <ProjectCard
                key={pd.project.id}
                pd={pd}
                allProjects={allProjects}
                onSelectTask={setDetailTask}
                onAddTask={id => setAddTaskProjectId(id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Task detail panel */}
      {detailTask && (
        <TaskDetail
          task={detailTask}
          projects={allProjects}
          onClose={() => setDetailTask(null)}
        />
      )}

      {/* Add task modal (pre-seeded to a specific project) */}
      {addTaskProjectId && (
        <AddTaskModal
          projects={allProjects}
          initialProjectId={addTaskProjectId}
          onClose={() => setAddTaskProjectId(null)}
          onCreated={() => setAddTaskProjectId(null)}
        />
      )}
    </>
  )
}
