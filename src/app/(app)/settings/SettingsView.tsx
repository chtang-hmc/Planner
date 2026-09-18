'use client'

import { useTheme } from 'next-themes'
import { useState, useTransition } from 'react'
import { ACCENTS, ACCENT_DEFAULT, AccentId, applyAccent, getStoredAccent } from '@/components/Providers'
import { triggerCalendarSync, disconnectCalendar } from '@/app/actions/calendar'
import SchedulingSettings from '@/components/SchedulingSettings'
import type { WorkingHours, EnergyScheduleEntry } from '@/lib/scheduler'
import type { DailyBreak } from '@/app/actions/scheduling'
import { useStored, useHydrated, writeStored } from '@/lib/use-stored'
import {
  LightIcon, DarkIcon, SystemIcon, CalendarIcon, WarningIcon, DoneIcon,
} from '@/components/icons'
import { List as ListIcon } from 'lucide-react'
import { saveRelevanceSettings } from '@/app/actions/scheduling'
import {
  relevanceHint, RELEVANT_WINDOW_MIN, RELEVANT_WINDOW_MAX, type RelevanceConfig,
} from '@/lib/relevance'
import {
  TASK_LAYOUTS, DEFAULT_TASK_LAYOUT, getStoredTaskLayout, storeTaskLayout,
  type TaskLayoutId,
} from '@/lib/task-layouts'

// ── Theme toggle ──────────────────────────────────────────────────────────────

const THEME_OPTIONS = [
  { id: 'light',  label: 'Light',  Icon: LightIcon  },
  { id: 'dark',   label: 'Dark',   Icon: DarkIcon   },
  { id: 'system', label: 'System', Icon: SystemIcon },
] as const

function ThemeSection() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  // next-themes only knows the resolved theme in the browser, so the control
  // cannot be rendered server-side at all.
  const mounted = useHydrated()

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Appearance</h2>
      <p className="text-xs text-slate-400 mb-4">
        Choose how Planner looks. System follows your OS setting.
        {mounted && resolvedTheme && (
          <span className="ml-1 text-slate-300 dark:text-slate-600">(currently {resolvedTheme})</span>
        )}
      </p>

      <div className="flex gap-2">
        {THEME_OPTIONS.map(opt => {
          const active = mounted && theme === opt.id
          return (
            <button
              key={opt.id}
              onClick={() => setTheme(opt.id)}
              className={`flex-1 flex flex-col items-center gap-2 py-4 px-3 rounded-xl border-2 transition-all ${
                active
                  ? 'border-accent-500 bg-accent-50 dark:bg-accent-950'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              <opt.Icon size={18} />
              <span className={`text-xs font-medium ${
                active ? 'text-accent-700 dark:text-accent-300' : 'text-slate-600 dark:text-slate-400'
              }`}>
                {opt.label}
              </span>
              {active && (
                <span className="w-1.5 h-1.5 rounded-full bg-accent-500" />
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}

// ── Accent color picker ───────────────────────────────────────────────────────

function AccentSection() {
  // Read straight from storage rather than mirrored into state: one source, so
  // the two cannot drift, and writeStored below re-renders every reader.
  const accent  = useStored(getStoredAccent, ACCENT_DEFAULT as AccentId)
  const mounted = useHydrated()

  function handleSelect(id: AccentId) {
    // applyAccent writes the preference and repaints the document; writeStored
    // is what tells this component (and any other reader) to re-render.
    writeStored(() => applyAccent(id))
  }

  if (!mounted) return null

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Color theme</h2>
      <p className="text-xs text-slate-400 mb-4">
        Sets the accent for buttons and navigation, and tints every surface,
        border and label to match. Works with both light and dark.
      </p>

      <div className="flex gap-3 flex-wrap">
        {ACCENTS.map(a => {
          const active = accent === a.id
          return (
            <button
              key={a.id}
              onClick={() => handleSelect(a.id)}
              className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border-2 transition-all ${
                active
                  ? 'border-transparent ring-2 ring-offset-2 ring-offset-white dark:ring-offset-slate-900'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
              style={active ? { borderColor: a.color } : undefined}
            >
              <span
                className="w-4 h-4 rounded-full shrink-0"
                style={{ background: a.color }}
              />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {a.label}
              </span>
              {active && <span className="text-xs" style={{ color: a.color }}>✓</span>}
            </button>
          )
        })}
      </div>

      {/* Live preview strip */}
      <div className="mt-5 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col gap-3">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Preview</p>

        {/* Simulated sidebar item */}
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-accent-50 dark:bg-accent-950 w-fit">
          <span className="text-xs font-mono text-accent-500">✓</span>
          <span className="text-sm font-medium text-accent-700 dark:text-accent-300">Active nav item</span>
        </div>

        {/* Simulated button */}
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 rounded-lg bg-accent-500 text-white text-xs font-medium hover:bg-accent-600 transition-colors">
            Primary button
          </button>
          <button className="px-3 py-1.5 rounded-lg border border-accent-300 dark:border-accent-700 text-accent-700 dark:text-accent-300 text-xs font-medium">
            Secondary
          </button>
          <input
            type="text"
            placeholder="Focus ring…"
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-accent-500 w-32"
          />
        </div>
      </div>
    </section>
  )
}

// ── Default task view ─────────────────────────────────────────────────────────

const VIEW_KEY = 'planner-default-view'
export type DefaultView = 'list' | 'upcoming'

export function getStoredDefaultView(): DefaultView {
  if (typeof window === 'undefined') return 'list'
  const v = localStorage.getItem(VIEW_KEY)
  return v === 'upcoming' ? 'upcoming' : 'list'
}

const VIEW_OPTIONS = [
  { id: 'list' as const,     label: 'List',     Icon: ListIcon,     desc: 'All active tasks sorted by urgency' },
  { id: 'upcoming' as const, label: 'Upcoming', Icon: CalendarIcon, desc: 'Tasks laid out day-by-day on a calendar' },
]

function DefaultViewSection() {
  const view    = useStored(getStoredDefaultView, 'list' as DefaultView)
  const mounted = useHydrated()

  function handleSelect(v: DefaultView) {
    writeStored(() => localStorage.setItem(VIEW_KEY, v))
  }

  if (!mounted) return null

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Default task view</h2>
      <p className="text-xs text-slate-400 mb-4">
        Which view opens first when you go to Tasks.
      </p>
      <div className="flex gap-2">
        {VIEW_OPTIONS.map(opt => {
          const active = view === opt.id
          return (
            <button
              key={opt.id}
              onClick={() => handleSelect(opt.id)}
              className={`flex-1 flex flex-col items-center gap-2 py-4 px-3 rounded-xl border-2 transition-all ${
                active
                  ? 'border-accent-500 bg-accent-50 dark:bg-accent-950'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              <opt.Icon size={18} />
              <span className={`text-xs font-medium ${
                active ? 'text-accent-700 dark:text-accent-300' : 'text-slate-600 dark:text-slate-400'
              }`}>
                {opt.label}
              </span>
              <span className={`text-xs text-center leading-snug ${
                active ? 'text-accent-500 dark:text-accent-400' : 'text-slate-400'
              }`}>
                {opt.desc}
              </span>
              {active && <span className="w-1.5 h-1.5 rounded-full bg-accent-500" />}
            </button>
          )
        })}
      </div>
    </section>
  )
}

// ── Google Calendar ───────────────────────────────────────────────────────────

interface GCalSectionProps {
  connected: boolean
  hasWriteScope: boolean
  connectedAt: string | null
}

function GoogleCalendarSection({ connected, hasWriteScope, connectedAt }: GCalSectionProps) {
  const [syncing,       setSyncing]      = useState(false)
  const [syncMsg,       setSyncMsg]      = useState<string | null>(null)
  const [, startTransition]             = useTransition()

  function handleSync() {
    setSyncing(true)
    setSyncMsg(null)
    startTransition(async () => {
      try {
        await triggerCalendarSync()
        setSyncMsg('Synced ✓')
      } catch {
        setSyncMsg('Sync failed')
      } finally {
        setSyncing(false)
      }
    })
  }

  function handleDisconnect() {
    startTransition(() => disconnectCalendar())
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Google Calendar</h2>
      <p className="text-xs text-slate-400 mb-4">
        Sync your calendar events to the Upcoming view and block focus time for tasks.
      </p>

      {!connected ? (
        /* Not connected */
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <CalendarIcon size={18} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Not connected</p>
              <p className="text-xs text-slate-400">Connect to see events and schedule focus blocks</p>
            </div>
          </div>
          <a
            href="/api/auth/google"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-semibold hover:opacity-80 transition-opacity"
          >
            <svg className="w-4 h-4" viewBox="0 0 48 48" fill="none">
              <path d="M43.6 20.5H42V20H24v8h11.3C33.6 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.5 6.5 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z" fill="#FFC107"/>
              <path d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.5 6.5 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" fill="#FF3D00"/>
              <path d="M24 44c5.5 0 10.4-2 14.1-5.3l-6.5-5.5C29.7 35 27 36 24 36c-5.3 0-9.6-2.9-11.3-7l-6.6 5.1C9.5 39.6 16.3 44 24 44z" fill="#4CAF50"/>
              <path d="M43.6 20.5H42V20H24v8h11.3c-.9 2.5-2.5 4.6-4.6 6.1l6.5 5.5C37.2 39.7 44 34.6 44 24c0-1.2-.1-2.4-.4-3.5z" fill="#1976D2"/>
            </svg>
            Connect Google Calendar
          </a>
        </div>
      ) : !hasWriteScope ? (
        /* Connected but only read-only scope — needs upgrade for scheduling */
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
            <WarningIcon size={15} className="mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Read-only access</p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                Your calendar is connected but only has read access. Reconnect to enable scheduling tasks as focus blocks.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <a
              href="/api/auth/google"
              className="flex-1 text-center px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors"
            >
              Upgrade access
            </a>
            <button
              onClick={handleDisconnect}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm text-slate-500 hover:text-red-500 hover:border-red-200 dark:hover:border-red-800 transition-colors"
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        /* Connected with full write scope */
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30">
            <DoneIcon size={18} className="text-accent-500" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-green-700 dark:text-green-300">Connected</p>
              <p className="text-xs text-green-600 dark:text-green-500 mt-0.5">
                Events sync automatically · Focus blocks can be scheduled from any task
                {connectedAt && (
                  <span className="ml-1 text-green-500/60">
                    · since {new Date(connectedAt).toLocaleDateString()}
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex-1 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-600 dark:text-slate-400 hover:border-accent-400 hover:text-accent-600 dark:hover:text-accent-400 disabled:opacity-40 transition-colors"
            >
              {syncing ? 'Syncing…' : syncMsg ?? '↻ Sync now'}
            </button>
            <button
              onClick={handleDisconnect}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm text-slate-500 hover:text-red-500 hover:border-red-200 dark:hover:border-red-800 transition-colors"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

// ── Task row layout ───────────────────────────────────────────────────────────

/**
 * Which of the four row layouts the task list draws.
 *
 * Each card carries its own description rather than a name alone: the
 * difference between Rail and Airy is density and hierarchy, which a label
 * can't convey, and anything a layout deliberately leaves out is stated so the
 * choice is informed rather than a guess.
 */
export function TaskLayoutSection() {
  const layout  = useStored(getStoredTaskLayout, DEFAULT_TASK_LAYOUT)
  const mounted = useHydrated()

  function handleSelect(id: TaskLayoutId) {
    writeStored(() => storeTaskLayout(id))
  }

  if (!mounted) return null

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Task list layout</h2>
      <p className="text-xs text-slate-400 mb-4">
        How a task is drawn in the list. Takes effect next time you open Tasks.
      </p>

      <div className="grid grid-cols-2 gap-2">
        {TASK_LAYOUTS.map(opt => {
          const active = layout === opt.id
          return (
            <button
              key={opt.id}
              onClick={() => handleSelect(opt.id)}
              className={`flex flex-col items-start gap-1.5 p-3 rounded-xl border-2 text-left transition-all ${
                active
                  ? 'border-accent-500 bg-accent-50 dark:bg-accent-950'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              <span className="flex items-center gap-2 w-full">
                <span className={`text-xs font-semibold ${
                  active ? 'text-accent-700 dark:text-accent-300' : 'text-slate-700 dark:text-slate-300'
                }`}>
                  {opt.label}
                </span>
                <span className="text-[10px] text-slate-400 uppercase tracking-wide">{opt.density}</span>
                {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent-500" />}
              </span>
              <span className={`text-[11px] leading-snug ${
                active ? 'text-accent-600 dark:text-accent-400' : 'text-slate-400'
              }`}>
                {opt.blurb}
              </span>
            </button>
          )
        })}
      </div>

      {(() => {
        const meta = TASK_LAYOUTS.find(l => l.id === layout)
        if (!meta) return null
        return (
          <div className="mt-3 px-3.5 py-3 rounded-xl bg-slate-50 dark:bg-slate-800/40">
            <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{meta.description}</p>
            {meta.omits.length > 0 && (
              <p className="text-[11px] leading-relaxed text-slate-400 mt-2">
                <span className="font-medium">Leaves out:</span> {meta.omits.join('; ')}.
              </p>
            )}
          </div>
        )
      })()}

      <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
        All four drop the urgency score and curve from the row — an internal
        number that is hard to act on, and still shown on the task itself. They
        also replace emoji with words, and the filled project chip with a dot,
        so the only colour in a row is how close the deadline is.
      </p>
    </section>
  )
}

/**
 * The two numbers behind the task list's "Relevant" toggle.
 *
 * The filter is on by default, so these decide what the list looks like on
 * arrival — which makes them worth surfacing rather than leaving as constants
 * someone has to go and find in the source. The preview line spells out the
 * rule in the user's own terms, because "relevant" on its own explains nothing.
 */
function RelevanceSection({ relevance }: { relevance: RelevanceConfig }) {
  const [windowDays, setWindowDays]   = useState(String(relevance.windowDays))
  const [minPriority, setMinPriority] = useState(relevance.minPriority)
  const [error, setError]   = useState<string | null>(null)
  const [saved, setSaved]   = useState(false)
  const [pending, start]    = useTransition()

  const parsedWindow = Number(windowDays)
  const windowValid  = Number.isInteger(parsedWindow)
    && parsedWindow >= RELEVANT_WINDOW_MIN && parsedWindow <= RELEVANT_WINDOW_MAX

  function save(nextWindow: number, nextPriority: number) {
    setError(null)
    setSaved(false)
    start(async () => {
      const res = await saveRelevanceSettings(nextWindow, nextPriority)
      if (res.error) setError(res.error)
      else setSaved(true)
    })
  }

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
              type="number"
              min={RELEVANT_WINDOW_MIN}
              max={RELEVANT_WINDOW_MAX}
              value={windowDays}
              onChange={e => setWindowDays(e.target.value)}
              onBlur={() => windowValid && save(parsedWindow, minPriority)}
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
            {([1, 2, 3, 4] as const).map(p => (
              <button
                key={p}
                onClick={() => { setMinPriority(p); if (windowValid) save(parsedWindow, p) }}
                className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${
                  minPriority === p
                    ? 'border-accent-500 bg-accent-50 dark:bg-accent-950 text-accent-700 dark:text-accent-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'
                }`}
              >
                {PRIORITY_NAMES[p]}+
              </button>
            ))}
          </div>
        </div>

        {/* The rule, in the terms just chosen. Without it "Relevant" is a word
            with no visible meaning until something goes missing from the list. */}
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed border-l-2 border-slate-200 dark:border-slate-700 pl-3">
          {relevanceHint({
            windowDays: windowValid ? parsedWindow : relevance.windowDays,
            minPriority,
          })}
        </p>

        {!windowValid && (
          <p className="text-xs text-amber-500">
            Enter a whole number between {RELEVANT_WINDOW_MIN} and {RELEVANT_WINDOW_MAX}.
          </p>
        )}
        {error && <p className="text-xs text-amber-500">{error}</p>}
        {saved && !error && !pending && <p className="text-xs text-slate-400">Saved.</p>}
      </div>
    </section>
  )
}

const PRIORITY_NAMES = ['', 'Low', 'Med', 'High', 'Crit'] as const

/** One settings section. The border is what separates them now the rules are gone. */
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 ${className}`}>
      {children}
    </div>
  )
}

interface SettingsViewProps {
  gcalConnected:    boolean
  gcalHasWriteScope: boolean
  gcalConnectedAt:  string | null
  workingHours:     WorkingHours[]
  energySchedule:   EnergyScheduleEntry[]
  maxSession:       number
  bufferMinutes:    number
  weekStartDay:     number
  breaks:           DailyBreak[]
  relevance:        RelevanceConfig
}

export default function SettingsView({
  gcalConnected, gcalHasWriteScope, gcalConnectedAt,
  workingHours, energySchedule, maxSession, bufferMinutes, weekStartDay, breaks,
  relevance,
}: SettingsViewProps) {
  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur">
        <div className="px-6 py-3">
          <h1 className="font-semibold text-sm text-slate-900 dark:text-slate-100">Settings</h1>
        </div>
      </header>

      {/* Settings fill the panel.
          max-w-lg with no mx-auto pinned every control to the left edge and
          left the rest of the width blank — the same thing Projects and
          Analytics were doing. Sections are cards in a grid that breaks into
          two columns as the panel grows, rather than one column stretched to
          whatever the window is: a 1400px-wide row of radio buttons "fills the
          panel" and reads worse than the 512px it replaced.

          The dividers went with the change. A horizontal rule between sections
          only reads as a separator while they are in one stack; in a grid it is
          a line across the middle of nothing. The card edges do that job now.

          Scheduling spans both columns — it holds a week grid and an hours
          table, and was laid out to be wide. */}
      <div className="px-6 py-6 grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <Card><ThemeSection /></Card>
        <Card><AccentSection /></Card>
        <Card><DefaultViewSection /></Card>
        <Card><TaskLayoutSection /></Card>
        <Card><RelevanceSection relevance={relevance} /></Card>
        <Card>
          <GoogleCalendarSection
            connected={gcalConnected}
            hasWriteScope={gcalHasWriteScope}
            connectedAt={gcalConnectedAt}
          />
        </Card>
        <Card className="xl:col-span-2">
          <SchedulingSettings
            workingHours={workingHours}
            energySchedule={energySchedule}
            maxSession={maxSession}
            bufferMinutes={bufferMinutes}
            weekStartDay={weekStartDay}
            breaks={breaks}
          />
        </Card>
      </div>
    </div>
  )
}
