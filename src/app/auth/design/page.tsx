'use client'

/**
 * Layout preview — /auth/design
 *
 * Renders the real row components from TaskRowLayouts.tsx against fixture data,
 * so a layout can be looked at without logging in and without touching live
 * tasks. It sits under /auth because the proxy lets that prefix through without
 * a session (src/proxy.ts).
 *
 * Endpoints:
 *   /auth/design                  all four, stacked
 *   /auth/design?layout=rail      one layout on its own
 *   /auth/design?layout=ledger
 *   /auth/design?layout=airy
 *   /auth/design?layout=editorial
 *
 * It renders the shipping components rather than copies of them — a preview
 * that drifts from what the app draws is worse than no preview at all.
 */

import { useState, useSyncExternalStore } from 'react'
import { Project } from '@/types'
import { TASK_LAYOUT_IMPLS, type LayoutTask } from '@/components/TaskRowLayouts'
import { TASK_LAYOUTS, type TaskLayoutId } from '@/lib/task-layouts'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const proj = (name: string, color: string): Project =>
  ({ id: name, name, color, archived: false, created_at: '' })

function day(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10) + 'T00:00:00+00:00'
}

let n = 0
function task(partial: Partial<LayoutTask> & { title: string; project: Project }): LayoutTask {
  return {
    id: `fixture-${n++}`,
    project_id: partial.project.id, parent_id: null, description: null,
    status: 'inbox', type: 'task', priority: 2, energy_required: 'medium',
    estimated_minutes: null, adjusted_minutes: null, actual_minutes: null,
    due_date: null, start_date: null, urgency_score: 0, urgency_curve: 'linear',
    rrule: null, weekly_target: null, exclusive_group: null, location: 'anywhere',
    span_minutes: null, buffer_minutes: null, gcal_event_id: null,
    scheduled_start: null, scheduled_end: null, created_at: '', completed_at: null,
    ...partial,
  } as LayoutTask
}

const PP     = proj('Public Policy', '#7c3aed')
const TEACH  = proj('Teaching', '#0891b2')
const CLIN   = proj('Clinic', '#ea580c')
const HOME   = proj('Home', '#16a34a')
const COURSE = proj('Coursework', '#dc2626')
const INBOX  = proj('Inbox', '#94a3b8')

// A parent with subtasks, two recurring, a loose subtask, a someday, and a
// deliberately long title — the states that break a row layout.
const PARENT = task({ title: 'Public Policy Readings', project: PP, priority: 4, energy_required: 'high', estimated_minutes: 135, due_date: day(0) })
const KIDS: LayoutTask[] = [
  task({ title: 'Rosner',      project: PP, priority: 4, energy_required: 'high', estimated_minutes: 25, due_date: day(0), parent_id: PARENT.id }),
  task({ title: 'Baumgartner', project: PP, priority: 4, energy_required: 'high', estimated_minutes: 30, due_date: day(0), parent_id: PARENT.id }),
]
const OTHERS: LayoutTask[] = [
  task({ title: 'Print Readings',       project: PP,     priority: 2, energy_required: 'low',    estimated_minutes: 10,  due_date: day(0) }),
  task({ title: 'Grade Algorithms',     project: TEACH,  priority: 3, energy_required: 'medium', estimated_minutes: 90,  due_date: day(8), type: 'recurring' }),
  task({ title: 'Clinic Status Report', project: CLIN,   priority: 3, energy_required: 'medium', estimated_minutes: 45,  due_date: day(5), type: 'recurring' }),
  task({ title: 'Update Resume',        project: INBOX,  priority: 2, energy_required: 'medium', estimated_minutes: 60,  due_date: day(2) }),
  task({ title: 'Wash Sheets',          project: HOME,   priority: 2, energy_required: 'low',    estimated_minutes: 20,  due_date: day(4) }),
  task({ title: 'Review OS Processes',  project: COURSE, priority: 3, energy_required: 'high',   estimated_minutes: 120, due_date: day(4) }),
  { ...task({ title: 'Dahl', project: PP, priority: 4, energy_required: 'high', estimated_minutes: 20, due_date: day(0), parent_id: 'elsewhere' }),
    parent: { id: 'elsewhere', title: 'Philosophy Readings' } },
  task({ title: 'Learn a new language sometime this year', project: INBOX, priority: 1, energy_required: 'low', type: 'someday' }),
]

// ── Preview ──────────────────────────────────────────────────────────────────

function LayoutPreview({ id, expanded, onToggle }: {
  id: TaskLayoutId; expanded: boolean; onToggle: () => void
}) {
  const L = TASK_LAYOUT_IMPLS[id]
  const rows = [
    { t: PARENT, isChild: false, kids: KIDS.length },
    ...(expanded ? KIDS.map(k => ({ t: k, isChild: true, kids: 0 })) : []),
    ...OTHERS.map(t => ({ t, isChild: false, kids: 0 })),
  ]
  return (
    <L.Shell>
      {rows.map(({ t, isChild, kids }) => (
        <L.Row
          key={t.id}
          task={t}
          isChild={isChild}
          kidCount={kids}
          collapsed={!expanded}
          streak={null}
          onToggleFold={onToggle}
          onOpen={() => {}}
          onDone={e => e.stopPropagation()}
        />
      ))}
    </L.Shell>
  )
}

export default function DesignPreview() {
  // ?layout= can only be read in the browser. Reading it in a useState
  // initialiser rendered one thing on the server and another on the client,
  // which is a hydration failure; useSyncExternalStore renders the server value
  // first and swaps afterwards. `override` is undefined until a button is
  // pressed, so the URL wins on load and the buttons win after.
  const urlLayout = useSyncExternalStore(
    () => () => {},
    () => {
      const v = new URLSearchParams(window.location.search).get('layout')
      return TASK_LAYOUTS.some(l => l.id === v) ? (v as TaskLayoutId) : null
    },
    () => null,
  )
  const [override, setOverride] = useState<TaskLayoutId | null | undefined>(undefined)
  const only = override === undefined ? urlLayout : override
  const setOnly = setOverride

  const [expanded, setExpanded] = useState(false)
  const shown = only ? TASK_LAYOUTS.filter(l => l.id === only) : TASK_LAYOUTS

  const pill = (active: boolean) =>
    `text-xs px-3 py-1.5 rounded-lg border font-medium ${
      active
        ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white'
        : 'border-slate-200 dark:border-slate-700 text-slate-500'
    }`

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-10">
      <div className="max-w-2xl mx-auto px-6">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <button onClick={() => setOnly(null)} className={pill(!only)}>All</button>
          {TASK_LAYOUTS.map(l => (
            <button key={l.id} onClick={() => setOnly(l.id)} className={pill(only === l.id)}>
              {l.label}
            </button>
          ))}
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 font-medium ml-auto"
          >
            {expanded ? 'Collapse subtasks' : 'Expand subtasks'}
          </button>
        </div>
        <p className="text-[11px] text-slate-400 mb-8">
          Fixture data, real components. Choose one for real in Settings → Task list layout.
        </p>

        <div className="flex flex-col gap-14">
          {shown.map(l => (
            <section key={l.id}>
              <div className="flex items-baseline gap-3 mb-1">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{l.label}</h2>
                <span className="text-[10px] text-slate-400 uppercase tracking-wide">{l.density}</span>
                <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
              </div>
              <p className="text-[11px] text-slate-400 mb-4 leading-relaxed">{l.description}</p>
              <LayoutPreview id={l.id} expanded={expanded} onToggle={() => setExpanded(v => !v)} />
              {l.omits.length > 0 && (
                <p className="text-[11px] text-slate-400 mt-2">Leaves out: {l.omits.join('; ')}.</p>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
