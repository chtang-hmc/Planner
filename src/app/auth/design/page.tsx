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
import { CONTROL, Segmented, Toggle, HabitRow, HabitList } from '@/components/TaskChrome'
import { HabitStreak, CalendarEvent } from '@/types'
import Sidebar from '@/components/Sidebar'
import CalendarPanel from '@/components/CalendarPanel'
import { TimerProvider } from '@/contexts/TimerContext'
import AnalyticsView from '@/app/(app)/analytics/AnalyticsView'
import HabitsView from '@/app/(app)/habits/HabitsView'
import type { AnalyticsData } from '@/app/(app)/analytics/page'

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

const HABITS = [
  { t: task({ title: 'Gym',   project: HOME, type: 'habit', weekly_target: 2, estimated_minutes: 90 }),
    s: { task_id: '1', current_streak: 3, longest_streak: 9, last_completed: '', week_start: '', completions_this_week: 2 } },
  { t: task({ title: 'Piano', project: HOME, type: 'habit', weekly_target: 7, estimated_minutes: 60, rrule: 'FREQ=DAILY' }),
    s: { task_id: '2', current_streak: 12, longest_streak: 12, last_completed: '', week_start: '', completions_this_week: 4 } },
  { t: task({ title: 'Learn Language', project: HOME, type: 'habit' }), s: null },
] as { t: LayoutTask; s: HabitStreak | null }[]

/** The toolbar, against fixture state. */
function ToolbarPreview() {
  const [view, setView]       = useState('list')
  const [energy, setEnergy]   = useState('all')
  const [relevant, setRel]    = useState(true)
  const [byProject, setByPrj] = useState(false)
  const [someday, setSomeday] = useState(false)
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      <div className="px-6 pt-4 pb-3 flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <div className="flex items-baseline gap-3 min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">Tasks</h1>
            <span className="text-xs text-slate-400 tabular-nums truncate">9 tasks · 8h 10m</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className={`${CONTROL} hidden md:flex items-center overflow-hidden`}>
              <input type="date" defaultValue="2026-09-16"
                className="px-2 h-full text-xs bg-transparent text-slate-600 dark:text-slate-300 focus:outline-none" />
              <button className="px-2.5 h-full text-xs font-medium text-slate-500 border-l border-slate-200 dark:border-slate-700">Plan</button>
            </div>
            <button className={`${CONTROL} px-3 font-medium text-slate-500`}>Schedule week</button>
            <button className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium px-3.5 h-7 rounded-lg">
              Add task
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Segmented value={view} onChange={setView}
            options={[{ id: 'list', label: 'List' }, { id: 'upcoming', label: 'Upcoming' }]} />
          <span className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-0.5" />
          <Segmented value={energy} onChange={setEnergy} hint="Energy"
            options={[{ id: 'all', label: 'Any' }, { id: 'low', label: 'Low' }, { id: 'medium', label: 'Med' }, { id: 'high', label: 'High' }]} />
          <select className={`${CONTROL} px-2.5 text-slate-600 dark:text-slate-300 max-w-[10rem]`}>
            <option>All projects</option>
          </select>
          <Toggle on={relevant}  onClick={() => setRel(v => !v)}>Relevant</Toggle>
          <Toggle on={byProject} onClick={() => setByPrj(v => !v)}>By project</Toggle>
          <Toggle on={someday}   onClick={() => setSomeday(v => !v)}>Someday</Toggle>
        </div>
      </div>
    </div>
  )
}

const EVENTS: CalendarEvent[] = [
  { id: 'e1', gcal_id: 'e1', title: 'Clinic Overall Meeting', all_day: false, source: 'google_calendar',
    start_time: new Date(Date.now() + 36e5).toISOString(),  end_time: new Date(Date.now() + 72e5).toISOString() },
  { id: 'e2', gcal_id: 'e2', title: 'Piano', all_day: false, source: 'google_calendar',
    start_time: new Date(Date.now() + 108e5).toISOString(), end_time: new Date(Date.now() + 144e5).toISOString() },
  { id: 'e3', gcal_id: 'e3', title: 'Meeting w/ Castro', all_day: false, source: 'google_calendar',
    start_time: new Date(Date.now() + 9e7).toISOString(),   end_time: new Date(Date.now() + 9.36e7).toISOString() },
]

/** Sidebar and calendar panel in place, at their real widths. */
function ChromePreview() {
  const projects = [PP, TEACH, CLIN, HOME, COURSE]
  return (
    // The sidebar's EnergyLogger reads the timer context, which normally comes
    // from the app layout. The preview supplies it rather than stubbing the
    // sidebar, so what renders here is the real component.
    <TimerProvider>
      <div className="h-[520px] flex rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <Sidebar projects={projects} />
        <div className="flex-1 bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
          <p className="text-[11px] text-slate-400">page content</p>
        </div>
        <CalendarPanel events={EVENTS} connected />
      </div>
    </TimerProvider>
  )
}

const bias = (ratio: number, n: number) =>
  ({ id: 'b', project_id: 'p', bias_ratio: ratio, sample_count: n, updated_at: '' })

const ANALYTICS: AnalyticsData = {
  weekStartDay: 1,
  activeCount: 23, doneCount: 141, totalEstMinutes: 1290, avgUrgency: 46,
  urgencyBuckets: [4, 7, 6, 4, 2],
  projectStats: [
    { project: PP,     activeCount: 8, estimatedMinutes: 420, doneCount: 31, bias: bias(1.35, 12) },
    { project: TEACH,  activeCount: 4, estimatedMinutes: 260, doneCount: 48, bias: bias(0.92, 20) },
    { project: CLIN,   activeCount: 6, estimatedMinutes: 310, doneCount: 22, bias: bias(1.08, 7) },
    { project: COURSE, activeCount: 3, estimatedMinutes: 190, doneCount: 26, bias: bias(1.7, 5) },
    { project: HOME,   activeCount: 2, estimatedMinutes: 110, doneCount: 14, bias: null },
  ],
  accurateSessions: 38, inaccurateSessions: 17,
  recentEnergy: Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i))
    return { date: d.toISOString().slice(0, 10), avg: [3.2, 4.1, 2.8, 3.9, 4.4, 3.1, 3.6][i], count: 3 }
  }),
  energyPatterns: Array.from({ length: 7 * 18 }, (_, i) => ({
    day_of_week: Math.floor(i / 18),
    hour_of_day: (i % 18) + 6,
    avg_level: 1 + ((Math.sin(i * 1.7) + 1) * 2),
    sample_count: 4,
    computed_at: '',
  })),
}

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
      <div className="max-w-5xl mx-auto px-6">
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
          {!only && (
            <>
              <section>
                <div className="flex items-baseline gap-3 mb-4">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Sidebar &amp; calendar panel</h2>
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                </div>
                <ChromePreview />
              </section>
              <section>
                <div className="flex items-baseline gap-3 mb-4">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Habits page</h2>
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800">
                  <HabitsView
                    habits={HABITS.map(h => h.t)}
                    completionMap={Object.fromEntries(HABITS.map(h => [
                      h.t.title,
                      Array.from({ length: 30 }, (_, i) => {
                        const d = new Date(); d.setDate(d.getDate() - i)
                        return i % 3 === 0 ? d.toISOString().slice(0, 10) : ''
                      }).filter(Boolean),
                    ]))}
                    doneToday={[]}
                    projects={[HOME]}
                    streaks={Object.fromEntries(HABITS.filter(h => h.s).map(h => [h.t.id, h.s!]))}
                    gcalWriteEnabled
                    weekStartDay={1}
                    tz="America/Los_Angeles"
                  />
                </div>
              </section>
              <section>
                <div className="flex items-baseline gap-3 mb-4">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Analytics</h2>
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800">
                  <AnalyticsView data={ANALYTICS} />
                </div>
              </section>
              <section>
                <div className="flex items-baseline gap-3 mb-4">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Toolbar</h2>
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                </div>
                <ToolbarPreview />
              </section>
              <section>
                <div className="flex items-baseline gap-3 mb-4">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Habits section</h2>
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                </div>
                <HabitList count={HABITS.length}>
                  {HABITS.map(h => (
                    <HabitRow key={h.t.id} task={h.t} streak={h.s} pending={false}
                      onOpen={() => {}} onDone={e => e.stopPropagation()} onLogTime={e => e.stopPropagation()} />
                  ))}
                </HabitList>
              </section>
            </>
          )}
          {shown.map(l => (
            <section key={l.id} className="max-w-2xl">
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
