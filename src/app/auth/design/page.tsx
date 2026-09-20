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
import { notFound } from 'next/navigation'
import { Project } from '@/types'
import { TASK_LAYOUT_IMPLS, type LayoutTask } from '@/components/TaskRowLayouts'
import { TASK_LAYOUTS, type TaskLayoutId } from '@/lib/task-layouts'
import { CONTROL, Segmented, Toggle, HabitRow, HabitList } from '@/components/TaskChrome'
import { HabitStreak, CalendarEvent } from '@/types'
import QuickAddInput from '@/components/QuickAddInput'
import SettingsView, { TaskLayoutSection } from '@/app/(app)/settings/SettingsView'
import { relevanceHint } from '@/lib/relevance'
import { parseQuickAdd, formatTimeLabel } from '@/lib/quick-add'
import Sidebar from '@/components/Sidebar'
import CalendarPanel from '@/components/CalendarPanel'
import { TimerProvider } from '@/contexts/TimerContext'
import AnalyticsView from '@/app/(app)/analytics/AnalyticsView'
import HomeView from '@/app/(app)/HomeView'
import { TaskRow, GroupHeader, type TaskRowModel } from '@/components/ds/TaskRow'
import type { Capacity } from '@/lib/capacity'
import { buildHome, resolveAgainstParent, rightNowFrom, rightNowSentence, MIN_GAP_MINUTES, type HomeEvent, type HomeTask } from '@/lib/home'
import { freeGaps, localMidnight, workWindowFor, type Interval, type WorkingHours } from '@/lib/scheduler'
import { todayStr as todayIn } from '@/lib/day'
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

/** Fixed at module load: a fixture date, not a clock read during render. */
const FIXTURE_TODAY = new Date().toISOString().slice(0, 10)

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
        <Sidebar projects={projects} todayStr={FIXTURE_TODAY} />
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

/**
 * The real QuickAddInput against a fixed clock, so the highlighting and the
 * resolved labels can be seen without a session. The examples are the ones the
 * grammar is most likely to get subtly wrong.
 */
function QuickAddPreview() {
  const [text, setText] = useState('Email Rosner tomorrow at 5pm')
  const NOW = new Date('2026-09-16T19:00:00Z')   // Wed 16 Sep, noon in LA
  const quick = parseQuickAdd(text, { tz: 'America/Los_Angeles', now: NOW })

  const examples = [
    'Email Rosner tomorrow at 5pm',
    'Pay rent by friday',
    'Submit grades end of month',
    'Renew passport jan 27',
    'Standup 9am next monday',
    'Buy Tomorrowland tickets',
  ]

  return (
    <div className="max-w-2xl flex flex-col gap-3">
      <p className="text-xs text-slate-400">Clock pinned to Wed 16 Sep 2026, 12:00 America/Los_Angeles.</p>
      <QuickAddInput
        value={text}
        onChange={setText}
        tokens={quick.tokens}
        placeholder="e.g. Submit CS homework by Friday"
      />
      <div className="flex flex-wrap gap-1.5">
        {examples.map(e => (
          <button
            key={e}
            onClick={() => setText(e)}
            className="text-[11px] px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-400"
          >
            {e}
          </button>
        ))}
      </div>
      <div className="text-xs font-mono text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 rounded-lg p-3 flex flex-col gap-1">
        <span>title       {quick.title || '—'}</span>
        <span>dueDay      {quick.dueDay ?? '—'}</span>
        <span>dueISO      {quick.dueISO ?? '—'}</span>
        <span>time        {quick.timeMinutes === null ? '—' : formatTimeLabel(quick.timeMinutes)}</span>
        <span>tokens      {quick.tokens.map(t => `${t.type}:"${t.text}"→${t.label}`).join('  ') || '—'}</span>
      </div>
    </div>
  )
}

/**
 * The relevance controls, reading and writing local state instead of the server
 * action — enough to see the layout and the live hint line without a session.
 */
function RelevancePreview() {
  const [windowDays, setWindowDays]   = useState('7')
  const [minPriority, setMinPriority] = useState(3)
  const names = ['', 'Low', 'Med', 'High', 'Crit']
  const n = Number(windowDays)
  const valid = Number.isInteger(n) && n >= 0 && n <= 90

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Relevant tasks</h2>
      <p className="text-xs text-slate-400 mb-4">
        What the task list shows before you turn the Relevant filter off.
      </p>
      <div className="flex flex-col gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
            Deadlines within
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number" min={0} max={90} value={windowDays}
              onChange={e => setWindowDays(e.target.value)}
              className="w-24 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm font-mono bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
            <span className="text-xs text-slate-400">days ahead</span>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
            …or priority at least
          </label>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4].map(p => (
              <button
                key={p}
                onClick={() => setMinPriority(p)}
                className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${
                  minPriority === p
                    ? 'border-accent-500 bg-accent-50 dark:bg-accent-950 text-accent-700 dark:text-accent-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'
                }`}
              >
                {names[p]}+
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed border-l-2 border-slate-200 dark:border-slate-700 pl-3">
          {relevanceHint({ windowDays: valid ? n : 7, minPriority })}
        </p>
      </div>
    </section>
  )
}

// ── Home ─────────────────────────────────────────────────────────────────────
//
// The real HomeView, fed by the real buildHome over a fixture day — so the
// preview exercises the ranking and the gap arithmetic rather than a picture of
// them. The day is the one from docs/HOME.md, overlapping events and all, and
// "now" is pinned to 1:30pm so every section has something in it.

function HomePreview() {
  const tz    = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const today = todayIn(tz)
  const at = (h: number, m = 0) => localMidnight(today, tz) + (h * 60 + m) * 60_000

  const workingHours: WorkingHours[] = Array.from({ length: 7 }, (_, d) => ({
    day_of_week: d, start_hour: 10, start_minute: 0,
    end_hour: 1, end_minute: 30, enabled: true,     // 10:00 → 01:30 next morning
  }))

  // Fall Fest runs under ENTR 179A: the free block after them starts at 13:15,
  // not 12:15. If the preview ever shows a gap at 12:15, the trap is back.
  const events: HomeEvent[] = [
    { id: 'entr', title: 'ENTR 179A', startMs: at(11), endMs: at(12, 15) },
    { id: 'fest', title: 'Fall Fest', startMs: at(11), endMs: at(13, 15) },
    { id: 'csci', title: 'CSCI 134',  startMs: at(14, 45), endMs: at(16) },
    { id: 'piano', title: 'Piano',    startMs: at(16), endMs: at(17) },
    { id: 'clinic', title: 'Clinic Group Meeting', startMs: at(18), endMs: at(19) },
    { id: 'grut', title: 'Algs Grutoring', startMs: at(20), endMs: at(21) },
  ]

  const busy: Interval[] = events.map(e => [e.startMs, e.endMs])
  const gaps = freeGaps({ dayStr: today, tz, workingHours, busy, minMinutes: MIN_GAP_MINUTES }).gaps

  const fixture = (over: Partial<HomeTask> & { id: string; title: string }): HomeTask => ({
    parentId: null, parentTitle: null, type: 'task', priority: 2, urgencyScore: 50,
    energyRequired: 'medium', minutes: 30, dueDay: null, startDay: null,
    location: 'anywhere', bufferMinutes: null, scheduledStartISO: null, chainIndex: 0,
    ...over,
  })

  const readingParent = fixture({
    id: 'pp', title: 'Public Policy Readings', priority: 4, urgencyScore: 88, dueDay: today,
  })
  const readings = ['Rosner', 'Baumgartner', 'Dahl'].map((t, i) =>
    resolveAgainstParent(
      fixture({ id: `read-${i}`, title: t, parentId: 'pp', priority: 1, urgencyScore: 10, minutes: 30, chainIndex: i }),
      readingParent,
    ))

  const homeTasks: HomeTask[] = [
    ...readings,
    fixture({ id: 'resume', title: 'Update Resume', minutes: 45, priority: 3, urgencyScore: 62 }),
    fixture({ id: 'grade',  title: 'Grade Algorithms', minutes: 60, priority: 3, urgencyScore: 74, dueDay: today }),
    fixture({ id: 'print',  title: 'Print Readings', minutes: 15, priority: 2, urgencyScore: 44, location: 'away' }),
    fixture({ id: 'sheets', title: 'Wash Sheets', minutes: 10, priority: 1, urgencyScore: 18, location: 'home' }),
    fixture({ id: 'amazon', title: 'Buy stuff from Amazon', minutes: 30, priority: 1, urgencyScore: 10 }),
    fixture({ id: 'late',   title: 'Reimbursement form', minutes: 20, priority: 2, urgencyScore: 92, dueDay: day(-3).slice(0, 10) }),
  ]

  const data = buildHome({
    nowMs: at(13, 30), todayStr: today, tz,
    gaps, events, tasks: homeTasks, energySchedule: [], bufferMinutes: 15,
  })

  // HomeView opens task detail from these, so every id it can reach needs a row.
  const rows = homeTasks.map(h => task({
    title: h.title, project: h.parentId ? PP : INBOX,
    estimated_minutes: h.minutes, priority: h.priority as 1 | 2 | 3 | 4,
  }))
  rows.forEach((r, i) => { (r as { id: string }).id = homeTasks[i].id })

  /**
   * Every state the one-line answer can be in, at the hour that produces it.
   * The wording is the page's thesis, so it is worth being able to read all of
   * it at once rather than waiting until 8am to see one branch.
   */
  const sentences = [
    ['08:00', 'before the day opens'],
    ['12:00', 'inside an event'],
    ['13:30', 'inside a gap'],
    ['21:30', 'last gap of the day'],
    // 02:00 is the case the old code got wrong: last night's window closed at
    // 01:30 and today's has not opened, so it used to read as free-now.
    ['02:00', 'after midnight, before 10am'],
  ].map(([hhmm, note]) => {
    const [h, m] = hhmm.split(':').map(Number)
    return {
      hhmm, note,
      text: rightNowSentence(
        rightNowFrom({ nowMs: at(h, m), gaps, events, workWindow: workWindowFor(localMidnight(today, tz), workingHours, tz) }),
        tz,
      ),
    }
  })

  return (
    <TimerProvider>
      <div className="mb-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
        {sentences.map(s => (
          <div key={s.hhmm} className="flex items-baseline gap-3 px-4 py-2">
            <span className="text-[11px] font-mono tabular-nums text-slate-400 w-10 shrink-0">{s.hhmm}</span>
            <span className="text-[13px] text-slate-700 dark:text-slate-200 flex-1">{s.text}</span>
            <span className="text-[10px] text-slate-400 shrink-0">{s.note}</span>
          </div>
        ))}
      </div>
      <div className="h-[46rem] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <HomeView
          data={data}
          dayStr={today}
          tz={tz}
          allDayEvents={[{ id: 'bday', title: 'Mom’s birthday' }]}
          tasks={rows}
          habits={HABITS.map(h => h.t)}
          /* One already logged, so the ticked state is on screen too. */
          habitsDoneToday={[HABITS[1].t.id]}
          streaks={Object.fromEntries(HABITS.filter(h => h.s).map(h => [h.t.id, h.s!]))}
          projects={[PP, TEACH, CLIN, HOME, COURSE]}
          gcalWriteEnabled
          calendarConnected
          syncAge="2h ago"
          freeTime={{ observed: true }}
        />
      </div>
    </TimerProvider>
  )
}

/** A row of swatches, drawn from the live custom properties. */
function SwatchRow({ names, kind }: { names: string[]; kind: 'bg' | 'text' | 'border' }) {
  return (
    <div className="flex flex-wrap gap-2">
      {names.map(n => (
        <div key={n} className="rounded-lg border border-line p-2 min-w-[7.5rem] bg-surface">
          <div
            className="h-8 rounded-md mb-1.5"
            style={
              kind === 'text'
                ? { background: `var(--${n})` }
                : kind === 'border'
                  ? { border: `2px solid var(--${n})`, background: 'var(--surface-quiet)' }
                  : { background: `var(--${n})`, boxShadow: 'inset 0 0 0 1px var(--line)' }
            }
          />
          <div className="text-micro text-ink-2">{n}</div>
        </div>
      ))}
    </div>
  )
}

function SwatchHead({ children }: { children: React.ReactNode }) {
  return <p className="text-eyebrow uppercase tracking-wider text-ink-faint mt-4 mb-1.5">{children}</p>
}

/**
 * The design tokens, drawn.
 *
 * A palette you cannot look at is a palette you are guessing at, and these are
 * the values every component built from step 2 onward will resolve through.
 * Rendered from the real custom properties, so it cannot drift from
 * globals.css the way a hand-written swatch table would.
 *
 * Switch the accent to Paper in Settings to see the redesign's identity; the
 * neutral roles re-tint with it and keep their dark values.
 */
function TokenSpecimen() {
  const INK   = ['ink', 'ink-2', 'ink-3', 'ink-muted', 'ink-faint', 'ink-ghost']
  const SURF  = ['surface', 'surface-sunk', 'surface-quiet', 'track', 'track-soft']
  const LINE  = ['line', 'line-soft', 'line-strong']
  const SIG   = ['ok', 'ok-tint', 'danger', 'danger-tint', 'danger-fill', 'bar-free']
  const TYPE  = [
    ['display-l',  '38px', 'Sunday, 20 September'],
    ['display-s',  '31px', '5h 35m of today’s work will not fit.'],
    ['display-xs', '23px', 'Research is 44% of everything you have left.'],
  ] as const

  return (
    <div className="rounded-xl border border-line bg-surface-sunk p-5">
      <SwatchHead>Ink</SwatchHead><SwatchRow names={INK} kind="text" />
      <SwatchHead>Surfaces</SwatchHead><SwatchRow names={SURF} kind="bg" />
      <SwatchHead>Lines</SwatchHead><SwatchRow names={LINE} kind="border" />
      <SwatchHead>Signals — three, not five</SwatchHead><SwatchRow names={SIG} kind="text" />

      <SwatchHead>Capacity bar — three encodings, not one lightness ramp</SwatchHead>
      <div className="flex h-3.5 rounded-md overflow-hidden w-full max-w-md" style={{ background: 'var(--track)' }}>
        <div style={{ width: '16%', background: 'var(--ok)' }} />
        <div className="capacity-late" style={{ width: '32%' }} />
        <div style={{ width: '52%', background: 'var(--danger-fill)' }} />
      </div>
      <p className="text-micro text-ink-muted mt-1">
        solid · hatched · solid — the middle one survives a re-tint, a third lightness would not
      </p>

      <SwatchHead>Project colour, tint and shade derived</SwatchHead>
      <div className="flex flex-wrap gap-2">
        {[PP, TEACH, CLIN, HOME, COURSE].map(p => (
          <div
            key={p.id}
            className="project-tint rounded-lg px-2.5 py-1.5 flex items-center gap-2"
            style={{ ['--project' as string]: p.color }}
          >
            <span className="w-[7px] h-[7px] rounded-full" style={{ background: p.color }} />
            <span className="project-shade text-small font-medium" style={{ ['--project' as string]: p.color }}>
              {p.name}
            </span>
          </div>
        ))}
      </div>
      <p className="text-micro text-ink-muted mt-1">
        <code>projects.color</code> is user data, so these are color-mix, not tokens
      </p>

      <SwatchHead>Type</SwatchHead>
      {TYPE.map(([name, size, sample]) => (
        <div key={name} className="flex items-baseline gap-3 py-0.5">
          <span className="num text-micro text-ink-ghost w-24 shrink-0">{name}</span>
          <span className="display text-ink" style={{ fontSize: size }}>{sample}</span>
        </div>
      ))}
      <div className="flex items-baseline gap-3 py-1 mt-1">
        <span className="num text-micro text-ink-ghost w-24 shrink-0">.num</span>
        <span className="num text-ink-2">1h 00m · 45m · 2h 30m · 11:15pm · 10:00am</span>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="num text-micro text-ink-ghost w-24 shrink-0">body</span>
        <span className="text-ink-3">Geist — every label, control and table cell</span>
      </div>
    </div>
  )
}

/** A list container, so the rows sit on the surface they will live on. */
function Surface({ children, width }: { children: React.ReactNode; width?: number }) {
  return (
    <div
      className="rounded-xl border border-line bg-surface overflow-hidden"
      style={width ? { width } : undefined}
    >
      {children}
    </div>
  )
}

/**
 * The row and the header, at both widths, against the states that break them.
 *
 * A long title, a task with no estimate, an overdue one, a chained one, and a
 * group that fits beside a group that does not. These are the cases a layout
 * gets wrong, so they are the ones worth being able to look at.
 */
function RowSpecimen() {
  const rows: TaskRowModel[] = [
    { id: '1', title: 'Update Resume', color: '#B25A12', project: 'Jobs', minutes: 60, urgency: 92, lateLabel: '2 days late' },
    { id: '2', title: 'Claremont City Council Recording and Transcription Review', color: null, project: 'Inbox', minutes: 150, urgency: 71 },
    { id: '3', title: 'Clinic SOW', color: '#2E5FA3', project: 'Clinic', minutes: 60, urgency: 64, chip: 'scheduled 5:45pm' },
    { id: '4', title: 'Wash Sheets', color: '#A63A66', project: 'Personal', minutes: 20, urgency: 22, chip: '3 steps' },
    { id: '5', title: 'Buy stuff from Amazon', color: null, project: 'Inbox', minutes: null, urgency: 10 },
  ]

  const over: Capacity  = { dueTotal: 650, freeBeforeCutoff: 105, freeAfterCutoff: 210 }
  const fits: Capacity  = { dueTotal: 210, freeBeforeCutoff: 290, freeAfterCutoff: 0 }
  const tight: Capacity = { dueTotal: 240, freeBeforeCutoff: 60,  freeAfterCutoff: 210 }

  return (
    <div className="flex flex-col gap-4">
      <Surface>
        <GroupHeader label="Today" count={9} capacity={over} action={{ label: 'Triage 5h 35m', onClick: () => {} }} />
        {rows.map(t => <TaskRow key={t.id} task={t} />)}
        <GroupHeader label="Tomorrow · Mon 21" count={3} capacity={fits} action={{ label: 'Pull forward 1h 20m', onClick: () => {} }} />
        {rows.slice(2, 4).map(t => <TaskRow key={`b${t.id}`} task={t} />)}
        <GroupHeader label="Tuesday 22" count={2} capacity={tight} />
        {rows.slice(0, 1).map(t => <TaskRow key={`c${t.id}`} task={t} />)}
        <GroupHeader label="No date" count={1} />
        {rows.slice(4).map(t => <TaskRow key={`d${t.id}`} task={t} />)}
      </Surface>

      <div className="flex items-start gap-4 flex-wrap">
        <div>
          <p className="text-eyebrow uppercase tracking-wider text-ink-faint mb-1.5">Narrow — 390px</p>
          <Surface width={390}>
            <GroupHeader label="Today" count={9} capacity={over} narrow action={{ label: 'Triage', onClick: () => {} }} />
            {rows.map(t => <TaskRow key={`n${t.id}`} task={t} narrow />)}
          </Surface>
        </div>
        <p className="text-micro text-ink-muted max-w-[16rem] leading-relaxed">
          Two lines, 56px, no fixed columns — the wide row&rsquo;s 170px of right-hand
          furniture leaves about two words of title at this width, so it is deleted
          rather than compressed. The urgency meter goes with it: its length
          duplicates the sort order.
        </p>
      </div>
    </div>
  )
}

export default function DesignPreview() {
  // A development tool, not a feature. It lives under /auth so the proxy lets
  // it through without a session — the only way to look at these components in
  // a browser that is not logged in — and that same exemption would leave it
  // reachable by anyone in a deployed build.
  if (process.env.NODE_ENV === 'production') notFound()

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
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Design tokens</h2>
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                </div>
                <TokenSpecimen />
              </section>
              <section>
                <div className="flex items-baseline gap-3 mb-4">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Task row and group header</h2>
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                </div>
                <RowSpecimen />
              </section>
              <section>
                <div className="flex items-baseline gap-3 mb-4">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Home — today</h2>
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                </div>
                <HomePreview />
              </section>
              <section>
                <div className="flex items-baseline gap-3 mb-4">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Settings — simple / advanced</h2>
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                  <SettingsView
                    gcalConnected
                    gcalHasWriteScope
                    gcalConnectedAt={new Date().toISOString()}
                    workingHours={[]}
                    energySchedule={[]}
                    maxSession={90}
                    bufferMinutes={15}
                    weekStartDay={1}
                    breaks={[]}
                    relevance={{ windowDays: 7, minPriority: 3 }}
                  />
                </div>
              </section>
              <section>
                <div className="flex items-baseline gap-3 mb-4">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Relevance settings</h2>
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                </div>
                {/* Two cards in the real grid, to check the section sits in a
                    column rather than across the panel. */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
                    <RelevancePreview />
                  </div>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
                    {/* The real section, so the store round trip can be clicked:
                        picking a layout writes localStorage and every reader
                        re-renders from it, with no local copy in between. */}
                    <TaskLayoutSection />
                  </div>
                </div>
              </section>
              <section>
                <div className="flex items-baseline gap-3 mb-4">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Quick add</h2>
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                </div>
                <QuickAddPreview />
              </section>
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
