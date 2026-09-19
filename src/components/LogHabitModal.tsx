'use client'

import { useState, useEffect, useTransition } from 'react'
import { SquareCheck as CheckSquare, Square } from 'lucide-react'
import { Task } from '@/types'
import { logHabitSession } from '@/app/actions/tasks'
import { addDays } from '@/lib/day'

/** Local YYYY-MM-DD — the calendar day a session counts for, in your timezone. */
function localDateStr(d: Date) {
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0')
}
/** Local HH:MM for an <input type="time">. */
function localTimeStr(d: Date) {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

function fmtDuration(mins: number) {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60), m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

interface Props {
  habit: Task
  gcalWriteEnabled: boolean
  onClose: () => void
  /** Logged successfully — the caller updates its own optimistic state. */
  onLogged: (dateStr: string) => void
}

const DURATIONS = [15, 30, 45, 60, 90]

export default function LogHabitModal({
  habit, gcalWriteEnabled, onClose, onLogged,
}: Props) {
  const defaultMinutes = habit.estimated_minutes ?? 30

  /**
   * Everything clock-dependent, read once when the sheet opens.
   *
   * The modal is only ever rendered after a click, so there's no server pass to
   * disagree with — and reading the clock during render would make "is this in
   * the future" answer differently on every re-render.
   *
   * The defaults describe what usually just happened: you finished a session
   * and are logging it, so it *started* a session-length ago, not now.
   */
  const [opened] = useState(() => {
    const now   = new Date()
    const start = new Date(now.getTime() - defaultMinutes * 60_000)
    start.setMinutes(Math.floor(start.getMinutes() / 5) * 5, 0, 0)
    return {
      at:    now.getTime(),
      today: localDateStr(now),
      date:  localDateStr(start),
      time:  localTimeStr(start),
    }
  })

  const [dateStr, setDateStr] = useState(opened.date)
  const [timeStr, setTimeStr] = useState(opened.time)
  const [minutes, setMinutes] = useState(defaultMinutes)
  const [toCalendar, setToCalendar] = useState(gcalWriteEnabled)
  const [error, setError] = useState<string | null>(null)
  // The log landed but the calendar write didn't. The session is recorded, so
  // failing the whole thing would be a lie — say what didn't happen instead.
  const [partial, setPartial] = useState<{ dateStr: string; message: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Built in the browser, so "8:00 on the 14th" means 8:00 where you are.
  const start = dateStr && timeStr ? new Date(`${dateStr}T${timeStr}`) : null
  const end   = start ? new Date(start.getTime() + minutes * 60_000) : null
  const inFuture = start ? start.getTime() > opened.at : false

  function handleLog() {
    if (!start || inFuture) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await logHabitSession(habit.id, {
          startISO: start!.toISOString(),
          minutes,
          addToCalendar: toCalendar && gcalWriteEnabled,
        })
        // No dateStr back means nothing was written at all.
        if (!res.dateStr) { setError(res.error ?? 'Could not log that session'); return }
        if (res.error)    { setPartial({ dateStr: res.dateStr, message: res.error }); return }
        onLogged(res.dateStr)
      } catch (err) {
        // logHabitSession delegates to completeTask, which throws on a DB
        // error rather than returning one. Uncaught, that leaves the button
        // stuck on "Logging…" with nothing said.
        setError(err instanceof Error ? err.message : 'Could not log that session')
      }
    })
  }

  const field = 'w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500'
  const label = 'block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-950/40 dark:bg-slate-950/60" />

      <div
        className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Log {habit.title}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">When did you actually do it?</p>
        </div>

        <div className="px-5 pb-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Day</label>
              <input
                type="date"
                value={dateStr}
                max={opened.today}
                onChange={e => setDateStr(e.target.value)}
                className={field}
              />
              {/* Forgetting for a day or two is the normal case, and a date
                  picker is a poor way to say "yesterday". */}
              <div className="flex gap-1 mt-1.5">
                {[
                  { label: 'Today',     day: opened.today },
                  { label: 'Yesterday', day: addDays(opened.today, -1) },
                  { label: '2 days',    day: addDays(opened.today, -2) },
                ].map(o => (
                  <button
                    key={o.label}
                    type="button"
                    onClick={() => setDateStr(o.day)}
                    className={`flex-1 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                      dateStr === o.day
                        ? 'bg-violet-600 border-violet-600 text-white'
                        : 'border-slate-200 dark:border-slate-700 text-slate-400 hover:border-violet-300 hover:text-violet-500'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={label}>Started at</label>
              <input
                type="time"
                value={timeStr}
                onChange={e => setTimeStr(e.target.value)}
                className={field}
              />
            </div>
          </div>

          <div>
            <label className={label}>How long</label>
            <div className="flex gap-1">
              {DURATIONS.map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMinutes(n)}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                    minutes === n
                      ? 'bg-violet-600 border-violet-600 text-white'
                      : 'border-slate-200 dark:border-slate-700 text-slate-400 hover:border-violet-300 hover:text-violet-500'
                  }`}
                >
                  {n}m
                </button>
              ))}
            </div>
            <input
              type="number"
              min={1}
              step={5}
              value={minutes}
              onChange={e => setMinutes(Math.max(1, parseInt(e.target.value) || 1))}
              className="mt-1.5 w-full border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono"
            />
          </div>

          {start && end && (
            <p className={`text-xs ${inFuture ? 'text-amber-500' : 'text-slate-400'}`}>
              {inFuture
                ? "That's in the future — pick a time that's already happened."
                : `${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · ${fmtDuration(minutes)}`}
            </p>
          )}

          <button
            type="button"
            disabled={!gcalWriteEnabled}
            onClick={() => setToCalendar(v => !v)}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-colors ${
              !gcalWriteEnabled
                ? 'border-slate-200 dark:border-slate-800 text-slate-300 dark:text-slate-600 cursor-default'
                : toCalendar
                  ? 'bg-violet-600 border-violet-600 text-white'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-violet-300'
            }`}
          >
            {toCalendar && gcalWriteEnabled ? <CheckSquare size={15} className="shrink-0" /> : <Square size={15} className="shrink-0" />}
            <span className="text-xs leading-snug">
              {gcalWriteEnabled
                ? 'Put it on my Google Calendar, where it happened'
                : 'Connect Google Calendar in Settings to record sessions there'}
            </span>
          </button>

          {error && <p className="text-xs text-amber-500">{error}</p>}

          {partial ? (
            <>
              <p className="text-xs text-amber-500">{partial.message}</p>
              <button
                onClick={() => onLogged(partial.dateStr)}
                className="w-full rounded-xl py-2.5 text-sm font-semibold bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-80 transition-opacity"
              >
                Close
              </button>
            </>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 py-2 px-3 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLog}
                disabled={!start || inFuture || isPending}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold bg-violet-600 text-white hover:opacity-80 disabled:opacity-40 transition-opacity"
              >
                {isPending ? 'Logging…' : '✓ Log session'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
