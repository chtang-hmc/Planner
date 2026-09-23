'use client'

/**
 * Inside a project.
 *
 * The page this replaces spent a quarter of the viewport on four billboard
 * numbers that between them said "2 tasks", then left 60% of it empty. It was
 * not too short — it was loud and empty at the same time.
 *
 * One stat line carries every number those billboards did. The space goes to
 * the three things the page never said: what the project is for, what it has
 * on the calendar, and what repeats. It is still a short page, and for a
 * three-task project that is correct.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Task, Project, EstimationProfile, HabitStreak, CalendarEvent } from '@/types'
import { isActiveTask, isDoneTask } from '@/lib/projects'
import {
  projectStats, projectContext, repeatingTasks, linkedEvents, calendarTotal,
} from '@/lib/project-detail'
import { estimateAccuracy } from '@/lib/thin-data'
import { toTaskRowModel } from '@/lib/task-row'
import { TaskRow } from '@/components/ds/TaskRow'
import { ThinData } from '@/components/ds/ThinData'
import {
  StatLine, AboutPanel, RepeatingPanel, CalendarPanel,
} from '@/components/ds/ProjectPanels'
import { completeTask } from '@/app/actions/tasks'
import { archiveProject } from '@/app/actions/projects'
import TaskDetail from '@/components/TaskDetail'
import MicroReflection from '@/components/MicroReflection'
import AddTaskModal from '@/components/AddTaskModal'
import ProjectModal from '@/components/ProjectModal'

type FullTask = Omit<Task, 'project'> & { project: Project | null }
type Tab = 'active' | 'done' | 'all'

interface Props {
  project:          Project
  /** Every task in this project, at every status. */
  tasks:            FullTask[]
  allProjects:      Project[]
  bias:             EstimationProfile | null
  streaks:          Record<string, HabitStreak>
  gcalWriteEnabled: boolean
  links:            { task_id: string; event_id: string }[]
  events:           CalendarEvent[]
  todayStr:         string
  tz:               string
  /** The calendar block's window, as instants. */
  windowMs:         [number, number]
}

export default function ProjectDetailView({
  project, tasks, allProjects, bias, streaks, gcalWriteEnabled,
  links, events, todayStr, tz, windowMs,
}: Props) {
  const [detailTask,     setDetailTask]     = useState<(Task & { project: Project }) | null>(null)
  const [completingTask, setCompletingTask] = useState<(Task & { project: Project }) | null>(null)
  const [doneIds,        setDoneIds]        = useState<Set<string>>(new Set())
  const [pendingHabits,  setPendingHabits]  = useState<Set<string>>(new Set())
  const [showAdd,        setShowAdd]        = useState(false)
  const [editFocus,      setEditFocus]      = useState<'name' | 'description' | null>(null)
  const [archiving,      setArchiving]      = useState(false)
  const [tab,            setTab]            = useState<Tab>('active')

  const stats     = useMemo(() => projectStats(tasks), [tasks])
  const context   = useMemo(() => projectContext(tasks, todayStr), [tasks, todayStr])
  const repeating = useMemo(() => repeatingTasks(tasks), [tasks])

  const calendar = useMemo(() => linkedEvents({
    links,
    taskIds: new Set(tasks.map(t => t.id)),
    events,
    fromMs: windowMs[0],
    toMs:   windowMs[1],
  }), [links, tasks, events, windowMs])

  const accuracy = estimateAccuracy({
    projectName: project.name,
    sampleCount: bias?.sample_count ?? 0,
    biasRatio:   bias?.bias_ratio ?? null,
  })

  const active = tasks.filter(t => isActiveTask(t) && !doneIds.has(t.id))
  const done   = tasks.filter(t => isDoneTask(t) || doneIds.has(t.id))
  const shown  = tab === 'active' ? active : tab === 'done' ? done : [...active, ...done]

  const kidCounts = useMemo(() => {
    const n: Record<string, number> = {}
    for (const t of tasks) if (t.parent_id) n[t.parent_id] = (n[t.parent_id] ?? 0) + 1
    return n
  }, [tasks])

  const withProject = (t: FullTask) => ({ ...t, project } as Task & { project: Project })

  async function handleDone(t: FullTask) {
    // A habit has nothing to reflect on — it is the doing that counts, and a
    // modal between the tap and the tick is what made logging one feel heavy.
    if (t.type === 'habit') {
      if (pendingHabits.has(t.id)) return
      setPendingHabits(p => new Set([...p, t.id]))
      try {
        await completeTask(t.id, null, null, null)
        setDoneIds(p => new Set([...p, t.id]))
      } finally {
        setPendingHabits(p => { const n = new Set(p); n.delete(t.id); return n })
      }
      return
    }
    setCompletingTask(withProject(t))
  }

  async function handleArchive() {
    if (!confirm(`Archive "${project.name}"? Its tasks and history are kept.`)) return
    setArchiving(true)
    try { await archiveProject(project.id) } finally { setArchiving(false) }
  }

  const TABS: { id: Tab; label: string; n: number }[] = [
    { id: 'active', label: 'Active', n: active.length },
    { id: 'done',   label: 'Done',   n: done.length },
    { id: 'all',    label: 'All',    n: active.length + done.length },
  ]

  return (
    <>
      <div className="min-h-full bg-surface-sunk">
        <header className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur">
          <div className="px-6 py-3">
            <p className="text-micro text-ink-faint mb-1">
              <Link href="/projects" className="hover:text-ink-2 transition-colors">Projects</Link>
              <span className="mx-1.5">›</span>
              <span>{project.name}</span>
            </p>

            <div className="flex items-center gap-3 flex-wrap">
              <span aria-hidden className="w-3 h-3 rounded-full shrink-0" style={{ background: project.color }} />
              <h1 className="page-title text-ink truncate">{project.name}</h1>
              <span className="flex-1" />
              <button onClick={() => setEditFocus('name')}
                      className="h-8 px-3 rounded-ctrl border border-line text-small text-ink-2 hover:bg-surface-quiet transition-colors">
                Edit
              </button>
              <button onClick={handleArchive} disabled={archiving}
                      className="h-8 px-3 rounded-ctrl border border-line text-small text-ink-muted hover:text-danger transition-colors disabled:opacity-50">
                Archive
              </button>
              <button onClick={() => setShowAdd(true)}
                      className="h-8 px-3.5 rounded-ctrl bg-accent-600 text-white text-small font-semibold hover:bg-accent-700 transition-colors">
                Add task
              </button>
            </div>
          </div>
        </header>

        {/* Two columns above 1200, one below: the panels are context for the
            list, and stacking them under it is the right order to read them
            in when there is only one column. */}
        <div className="px-6 py-4 grid grid-cols-1 wide:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
          <div className="flex flex-col gap-4 min-w-0">
            <StatLine stats={stats} context={context} color={project.color} />

            <div className="flex items-center gap-0.5 p-[3px] rounded-ctrl bg-surface-sunk border border-line w-fit">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`h-[30px] px-3 rounded-[5px] text-small transition-colors ${
                    tab === t.id ? 'bg-surface text-ink font-semibold' : 'text-ink-muted hover:text-ink-2'
                  }`}
                >
                  {t.label} <span className="num text-ink-faint">{t.n}</span>
                </button>
              ))}
            </div>

            <div className="rounded-xl border border-line bg-surface overflow-hidden">
              {shown.length === 0 ? (
                <p className="px-4 py-10 text-center text-meta text-ink-ghost">
                  {tab === 'done' ? 'Nothing finished here yet.' : 'No active tasks in this project.'}
                </p>
              ) : shown.map(t => (
                <TaskRow
                  key={t.id}
                  hideProject
                  task={toTaskRowModel(t, {
                    kidCount: kidCounts[t.id] ?? 0,
                    todayStr,
                    done: doneIds.has(t.id) || t.status === 'done',
                  })}
                  onToggle={() => handleDone(t)}
                  onOpen={() => setDetailTask(withProject(t))}
                />
              ))}

              <button
                onClick={() => setShowAdd(true)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-micro text-ink-faint hover:text-accent-600 hover:bg-surface-quiet transition-colors border-t border-line-soft"
              >
                <span className="text-base leading-none">+</span> Add a task to {project.name}…
              </button>
            </div>

            <CalendarPanel events={calendar} total={calendarTotal(calendar)} tz={tz} />
          </div>

          <aside className="flex flex-col gap-5 rounded-xl border border-line bg-surface p-4">
            <AboutPanel description={project.description} onEdit={() => setEditFocus('description')} />
            <ThinData label="Estimate accuracy" data={accuracy} />
            <RepeatingPanel
              items={repeating}
              todayStr={todayStr}
              onOpen={id => {
                const t = tasks.find(x => x.id === id)
                if (t) setDetailTask(withProject(t))
              }}
            />
          </aside>
        </div>
      </div>

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
            setDoneIds(p => new Set([...p, completingTask.id]))
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

      {editFocus && (
        <ProjectModal project={project} focus={editFocus} onClose={() => setEditFocus(null)} />
      )}
    </>
  )
}
