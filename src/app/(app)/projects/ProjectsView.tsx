'use client'

import { useState, useRef, useEffect } from 'react'
import { EnergyIcon, EditIcon, ArchiveIcon } from '@/components/icons'
import { Task, Project, INBOX_PROJECT } from '@/types'
import { ProjectData } from './page'
import { archiveProject } from '@/app/actions/projects'
import TaskDetail from '@/components/TaskDetail'
import AddTaskModal from '@/components/AddTaskModal'
import ProjectModal from '@/components/ProjectModal'

// ── helpers ──────────────────────────────────────────────────────────────────


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

function BiasChip({ ratio, samples }: { ratio: number; samples: number }) {
  if (samples < 3) {
    return (
      <span className="text-xs text-slate-400 italic">
        Need {3 - samples} more sample{3 - samples !== 1 ? 's' : ''}
      </span>
    )
  }
  const pct  = Math.abs(Math.round((ratio - 1) * 100))
  const over = ratio > 1
  const diff = Math.abs(ratio - 1)
  const color =
    diff < 0.12 ? 'text-accent-600 dark:text-accent-400 bg-accent-50 dark:bg-accent-950 border-accent-200 dark:border-accent-800'
    : diff < 0.35 ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800'
    : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800'
  const label =
    diff < 0.05 ? '✓ Accurate'
    : over ? `↑ ${pct}% over`
    : `↓ ${pct}% under`
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${color}`}>
      {label}
    </span>
  )
}

// ── Project card ─────────────────────────────────────────────────────────────

interface CardProps {
  pd: ProjectData
  onSelectTask: (task: Task & { project: Project }) => void
  onAddTask: (projectId: string) => void
  onEdit: (project: Project) => void
}

function ProjectCard({ pd, onSelectTask, onAddTask, onEdit }: CardProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [menuOpen, setMenuOpen]   = useState(false)
  const [archiving, setArchiving] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const { project, activeTasks, doneCount, bias } = pd
  const totalEst   = activeTasks.reduce((s, t) => s + (t.adjusted_minutes ?? t.estimated_minutes ?? 0), 0)
  const totalCount = activeTasks.length + doneCount
  const pct        = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  async function handleArchive() {
    if (!confirm(`Archive "${project.name}"? It won't appear in lists, but its tasks and history are kept.`)) return
    setArchiving(true)
    try { await archiveProject(project.id) } finally { setArchiving(false) }
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 flex items-start justify-between gap-3">
        {/* Left — clickable to collapse */}
        <div
          className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer select-none"
          onClick={() => setCollapsed(v => !v)}
        >
          <div className="w-3 h-3 rounded-full shrink-0 mt-0.5" style={{ background: project.color }} />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
              {project.name}
            </h2>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs text-slate-400">
                {activeTasks.length} active · {doneCount} done
                {totalCount > 0 && <> · {pct}%</>}
              </span>
              {totalEst > 0 && (
                <span className="text-xs text-slate-400 font-mono">{formatMinutes(totalEst)} left</span>
              )}
            </div>
          </div>
        </div>

        {/* Right — bias chip + menu */}
        <div className="flex items-center gap-2 shrink-0">
          {bias && <BiasChip ratio={bias.bias_ratio} samples={bias.sample_count} />}

          {/* ⋯ menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={e => { e.stopPropagation(); setMenuOpen(v => !v) }}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-base"
              title="Project options"
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-8 z-20 w-40 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg overflow-hidden">
                <button
                  onClick={e => { e.stopPropagation(); setMenuOpen(false); onEdit(project) }}
                  className="w-full text-left px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <span className="flex items-center gap-2"><EditIcon size={12} /> Edit</span>
                </button>
                <button
                  onClick={e => { e.stopPropagation(); setMenuOpen(false); handleArchive() }}
                  disabled={archiving}
                  className="w-full text-left px-4 py-2.5 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/50 transition-colors disabled:opacity-50"
                >
                  <span className="flex items-center gap-2"><ArchiveIcon size={12} /> Archive</span>
                </button>
              </div>
            )}
          </div>

          <span
            className="text-slate-300 dark:text-slate-600 text-sm cursor-pointer select-none"
            onClick={() => setCollapsed(v => !v)}
          >
            {collapsed ? '›' : '⌄'}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="px-5 pb-0">
          <div className="h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: project.color }}
            />
          </div>
        </div>
      )}

      {/* Task list */}
      {!collapsed && (
        <div className="px-3 py-3">
          {activeTasks.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4 italic">All clear ✓</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {activeTasks.map(task => {
                const est = task.adjusted_minutes ?? task.estimated_minutes
                const due = formatDue(task.due_date)
                return (
                  <div
                    key={task.id}
                    onClick={() => onSelectTask({ ...task, project: task.project ?? INBOX_PROJECT })}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors"
                  >
                    {/* Urgency bar */}
                    <div
                      className="w-0.5 h-6 rounded-full shrink-0"
                      style={{
                        background:
                          task.urgency_score >= 70 ? '#ef4444'
                          : task.urgency_score >= 40 ? '#f59e0b'
                          : '#e2e8f0',
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-800 dark:text-slate-200 font-medium leading-snug truncate">
                        {task.title}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <EnergyIcon level={task.energy_required} className="text-slate-400" />
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

          <button
            onClick={e => { e.stopPropagation(); onAddTask(project.id) }}
            className="w-full mt-2 py-2 text-xs text-slate-400 hover:text-accent-600 dark:hover:text-accent-400 hover:bg-accent-50 dark:hover:bg-accent-950 rounded-xl transition-colors font-medium"
          >
            + Add task
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

interface Props {
  projectDataList: ProjectData[]
  allProjects: Project[]
}

export default function ProjectsView({ projectDataList, allProjects }: Props) {
  const [detailTask,      setDetailTask]      = useState<(Task & { project: Project }) | null>(null)
  const [addTaskProjId,   setAddTaskProjId]   = useState<string | null>(null)
  const [showNewProject,  setShowNewProject]  = useState(false)
  const [editingProject,  setEditingProject]  = useState<Project | null>(null)

  const totalActive = projectDataList.reduce((s, pd) => s + pd.activeTasks.length, 0)
  const totalDone   = projectDataList.reduce((s, pd) => s + pd.doneCount,          0)

  return (
    <>
      <div className="min-h-full bg-slate-50 dark:bg-slate-950">
        {/* Header */}
        <header className="sticky top-0 z-10 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur">
          <div className="px-6 py-3 flex items-center justify-between">
            <h1 className="font-semibold text-sm text-slate-900 dark:text-slate-100">Projects</h1>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 tabular-nums">
                {projectDataList.length} projects · {totalActive} active · {totalDone} done
              </span>
              <button
                onClick={() => setShowNewProject(true)}
                className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-3 py-1.5 rounded-lg text-xs font-medium hover:opacity-80 transition-opacity"
              >
                + New project
              </button>
            </div>
          </div>
        </header>

        {/* Project cards
            max-w-2xl with no mx-auto pinned everything to the left and left the
            rest of the panel empty. Cards now fill the width and break into
            columns as it grows — stretching one column to 1400px would "fill
            the panel" and read worse than the 672px it replaced.

            Two columns, not three: a card holds a project header, stats and a
            task list, and it was laid out for ~672px. Three columns on a wide
            monitor would put each one near 420px and crowd it. */}
        <div className="px-6 py-5 grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          {projectDataList.length === 0 ? (
            <div className="col-span-full text-center py-20">
              <p className="text-slate-400 text-sm mb-3">No projects yet.</p>
              <button
                onClick={() => setShowNewProject(true)}
                className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Create your first project →
              </button>
            </div>
          ) : (
            projectDataList.map(pd => (
              <ProjectCard
                key={pd.project.id}
                pd={pd}
                onSelectTask={setDetailTask}
                onAddTask={id => setAddTaskProjId(id)}
                onEdit={p => setEditingProject(p)}
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
          streak={null}
          gcalWriteEnabled={false}
          onClose={() => setDetailTask(null)}
        />
      )}

      {/* Add task modal */}
      {addTaskProjId && (
        <AddTaskModal
          projects={allProjects}
          initialProjectId={addTaskProjId}
          onClose={() => setAddTaskProjId(null)}
          onCreated={() => setAddTaskProjId(null)}
        />
      )}

      {/* Create project modal */}
      {showNewProject && (
        <ProjectModal onClose={() => setShowNewProject(false)} />
      )}

      {/* Edit project modal */}
      {editingProject && (
        <ProjectModal
          project={editingProject}
          onClose={() => setEditingProject(null)}
        />
      )}
    </>
  )
}
