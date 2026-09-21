'use client'

/**
 * Projects, as one table.
 *
 * The card grid this replaces forced a one-task project and a six-task project
 * to the same size, which left ragged holes down the page and made nothing
 * comparable — comparison being the only reason to have an overview. The rows
 * come from `buildProjectRows`, the same function the sidebar and Insights
 * will read, so the numbers on this page cannot disagree with theirs.
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Task, Project, INBOX_PROJECT } from '@/types'
import {
  buildProjectRows, sortProjectRows, projectsSummary, projectsFinding,
  isActiveTask, isDoneTask, taskMinutes,
  PROJECT_SORTS, type ProjectSort,
} from '@/lib/projects'
import { formatMinutes } from '@/lib/task-format'
import { toTaskRowModel } from '@/lib/task-row'
import { ProjectTable } from '@/components/ds/ProjectTable'
import { TaskRow } from '@/components/ds/TaskRow'
import { archiveProject } from '@/app/actions/projects'
import TaskDetail from '@/components/TaskDetail'
import MicroReflection from '@/components/MicroReflection'
import AddTaskModal from '@/components/AddTaskModal'
import ProjectModal from '@/components/ProjectModal'

/**
 * `Task['project']` is optional (`Project | undefined`) because most queries do
 * not join it. This one always does, and PostgREST returns `null` rather than
 * omitting the key for a task with no project — so the join is stated as
 * nullable rather than intersected with the optional field, which would give
 * the impossible `undefined & null`.
 */
type FullTask = Omit<Task, 'project'> & { project: Project | null }

interface Props {
  projects:         Project[]
  archivedProjects: Project[]
  /** Every task at every status — progress needs the completed ones. */
  tasks:            FullTask[]
  kidCounts:        Record<string, number>
  todayStr:         string
}

export default function ProjectsView({
  projects, archivedProjects, tasks, kidCounts, todayStr,
}: Props) {
  const router = useRouter()
  const [sort,           setSort]           = useState<ProjectSort>('left')
  const [expanded,       setExpanded]       = useState<string | null>(null)
  const [detailTask,     setDetailTask]     = useState<(Task & { project: Project }) | null>(null)
  const [addTaskProjId,  setAddTaskProjId]  = useState<string | null | undefined>(undefined)
  const [showNewProject, setShowNewProject] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [archiveOpen,    setArchiveOpen]    = useState(false)
  /* Completing from here goes through the same reflection the list uses.
     Calling `completeTask(id, null, null, null)` directly would skip the
     logged actual, which is the only thing feeding the estimate bias. */
  const [completing,     setCompleting]     = useState<(Task & { project: Project }) | null>(null)
  const [doneIds,        setDoneIds]        = useState<Set<string>>(new Set())

  const rows = useMemo(
    () => sortProjectRows(buildProjectRows({ projects, tasks, todayStr }), sort),
    [projects, tasks, todayStr, sort],
  )
  const summary = useMemo(() => projectsSummary(rows), [rows])
  const finding = useMemo(() => projectsFinding(rows), [rows])

  const doneTaskCount = tasks.filter(isDoneTask).length

  function tasksIn(projectId: string | null) {
    return tasks
      .filter(t => t.project_id === projectId && isActiveTask(t))
      .sort((a, b) => b.urgency_score - a.urgency_score)
  }

  return (
    <>
      <div className="min-h-full bg-surface-sunk">
        <header className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur">
          <div className="px-6 py-3 flex items-baseline justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-display-xs display text-ink leading-tight">Projects</h1>
              <p className="text-meta text-ink-muted mt-0.5">
                {summary.projectCount} project{summary.projectCount === 1 ? '' : 's'} ·{' '}
                {summary.activeCount} active task{summary.activeCount === 1 ? '' : 's'} ·{' '}
                <span className="num">{formatMinutes(summary.minutesLeft)}</span> of work left
              </p>
            </div>
            <button
              onClick={() => setShowNewProject(true)}
              className="h-9 px-4 rounded-ctrl bg-accent-600 text-white text-[13px] font-semibold hover:bg-accent-700 transition-colors"
            >
              New project
            </button>
          </div>
        </header>

        <div className="px-6 py-4 flex flex-col gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Four segments need ~300px and 390 does not have it — they wrap
                into a two-line control with uneven segment heights. The board
                draws a pill at narrow, so that is what this is: a real
                `<select>`, which also gets the platform picker on a phone. */}
            <label className="narrow:hidden relative flex items-center h-8 px-3 pr-7 rounded-full
                              border border-line bg-surface text-small text-ink-2">
              {PROJECT_SORTS.find(s => s.key === sort)!.label}
              <span aria-hidden className="absolute right-2.5 text-[9px] text-ink-faint">▾</span>
              <select
                aria-label="Sort projects"
                value={sort}
                onChange={e => setSort(e.target.value as ProjectSort)}
                className="absolute inset-0 opacity-0 cursor-pointer"
              >
                {PROJECT_SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>

            <div className="hidden narrow:flex items-center gap-0.5 p-[3px] rounded-ctrl bg-surface-sunk border border-line">
              <span className="px-2 text-micro text-ink-faint">Sort</span>
              {PROJECT_SORTS.map(s => (
                <button
                  key={s.key}
                  onClick={() => setSort(s.key)}
                  className={`h-[30px] px-3 rounded-[5px] text-small transition-colors ${
                    sort === s.key
                      ? 'bg-surface text-ink font-semibold'
                      : 'text-ink-muted hover:text-ink-2'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <span className="flex-1" />
            {finding && <span className="text-small text-danger">{finding}</span>}
          </div>

          {rows.length === 0 ? (
            <div className="rounded-xl border border-line bg-surface py-16 text-center">
              <p className="text-meta text-ink-muted mb-3">No projects yet.</p>
              <button onClick={() => setShowNewProject(true)}
                      className="text-meta font-medium text-accent-600 hover:underline underline-offset-2">
                Create your first project →
              </button>
            </div>
          ) : (
            <ProjectTable
              rows={rows}
              todayStr={todayStr}
              expanded={expanded}
              onToggle={setExpanded}
              /* Opening a project is a navigation, and the detail page is
                 where the description, the calendar and the estimate history
                 live — none of which fit in a row. */
              onOpen={id => { if (id) router.push(`/projects/${id}`) }}
            >
              {row => {
                const own = tasksIn(row.id)
                return (
                  <div className="divide-y divide-line-soft">
                    {own.map(t => (
                      <TaskRow
                        key={t.id}
                        hideProject
                        task={toTaskRowModel(t, {
                          kidCount: kidCounts[t.id] ?? 0, todayStr, done: doneIds.has(t.id),
                        })}
                        onToggle={() => setCompleting({ ...t, project: t.project ?? INBOX_PROJECT })}
                        onOpen={() => setDetailTask({ ...t, project: t.project ?? INBOX_PROJECT })}
                      />
                    ))}
                    <div className="flex items-center gap-4 px-4 h-[36px]">
                      <button onClick={() => setAddTaskProjId(row.id)}
                              className="text-meta text-ink-faint hover:text-accent-600 transition-colors">
                        Add a task…
                      </button>
                      <span className="flex-1" />
                      {/* Edit and Archive lived in a per-card ⋯ menu. The table
                          has no room for one per row, and both are things you
                          do having just looked at a project's tasks — which is
                          exactly here. */}
                      {!row.isInbox && (
                        <>
                          <button
                            onClick={() => {
                              const p = projects.find(x => x.id === row.id)
                              if (p) setEditingProject(p)
                            }}
                            className="text-micro text-ink-muted hover:text-ink-2 transition-colors">
                            Edit
                          </button>
                          <button
                            onClick={async () => {
                              if (!confirm(`Archive "${row.name}"? It won't appear in lists, but its tasks and history are kept.`)) return
                              await archiveProject(row.id!)
                            }}
                            className="text-micro text-ink-muted hover:text-danger transition-colors">
                            Archive
                          </button>
                          <a href={`/projects/${row.id}`}
                             className="text-meta font-semibold text-accent-600 hover:underline underline-offset-2">
                            Open {row.name} →
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                )
              }}
            </ProjectTable>
          )}

          <ArchiveRow
            open={archiveOpen}
            onToggle={() => setArchiveOpen(v => !v)}
            projects={archivedProjects}
            doneTaskCount={doneTaskCount}
            tasks={tasks}
          />
        </div>
      </div>

      {completing && (
        <MicroReflection
          task={completing}
          onClose={() => setCompleting(null)}
          onDone={() => {
            setDoneIds(prev => new Set([...prev, completing.id]))
            setCompleting(null)
          }}
        />
      )}

      {detailTask && (
        <TaskDetail
          task={detailTask}
          projects={projects}
          streak={null}
          gcalWriteEnabled={false}
          onClose={() => setDetailTask(null)}
        />
      )}

      {addTaskProjId !== undefined && (
        <AddTaskModal
          projects={projects}
          initialProjectId={addTaskProjId ?? undefined}
          onClose={() => setAddTaskProjId(undefined)}
          onCreated={() => setAddTaskProjId(undefined)}
        />
      )}

      {showNewProject && <ProjectModal onClose={() => setShowNewProject(false)} />}
      {editingProject && (
        <ProjectModal project={editingProject} onClose={() => setEditingProject(null)} />
      )}
    </>
  )
}

/**
 * Everything finished, in one row at the bottom.
 *
 * Completed tasks and archived projects are history rather than work, and the
 * table above is about what is left. They keep a row because "13 tasks done"
 * is worth seeing once, at the end, and because an archived project has to be
 * reachable from somewhere.
 */
function ArchiveRow({ open, onToggle, projects, doneTaskCount, tasks }: {
  open: boolean
  onToggle: () => void
  projects: Project[]
  doneTaskCount: number
  tasks: FullTask[]
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-sunk overflow-hidden">
      <button onClick={onToggle}
              className="w-full flex items-center gap-3 px-4 h-[52px] text-left hover:bg-surface-quiet transition-colors flex-wrap"
              aria-expanded={open}>
        <span className="text-[10px] leading-none text-ink-ghost">{open ? '▾' : '▸'}</span>
        <span className="text-[13px] font-semibold text-ink-2">Completed and archived</span>
        <span className="num text-small text-ink-faint">
          {doneTaskCount} task{doneTaskCount === 1 ? '' : 's'} ·{' '}
          {projects.length} project{projects.length === 1 ? '' : 's'}
        </span>
        <span className="flex-1" />
        {projects.length === 0 && (
          <span className="text-small text-ink-muted">No project has been archived yet.</span>
        )}
      </button>

      {open && projects.length > 0 && (
        <div className="border-t border-line divide-y divide-line-soft bg-surface">
          {projects.map(p => {
            const n = tasks.filter(t => t.project_id === p.id && isDoneTask(t)).length
            const mins = tasks.filter(t => t.project_id === p.id && isActiveTask(t))
              .reduce((s, t) => s + taskMinutes(t), 0)
            return (
              <a key={p.id} href={`/projects/${p.id}`}
                 className="flex items-center gap-3 px-4 h-[40px] hover:bg-surface-quiet transition-colors">
                <span aria-hidden className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                <span className="text-[13px] text-ink-2 truncate flex-1">{p.name}</span>
                <span className="num text-micro text-ink-faint">
                  {n} done{mins > 0 && <> · {formatMinutes(mins)} still open</>}
                </span>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}
