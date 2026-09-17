'use client'

import { useMemo, useState } from 'react'
import QuickAddInput from '@/components/QuickAddInput'
import { parseQuickAdd, formatTimeLabel } from '@/lib/quick-add'
import { DEFAULT_TZ, isValidTimezone } from '@/lib/day'

/**
 * The interactive half of the quick-add reference.
 *
 * Every example in the tables is resolved live, against the reader's own clock
 * and zone, by the same `parseQuickAdd` the add-task field calls. A docs page
 * that merely *claims* "friday → the next Friday" goes stale the moment the
 * grammar moves; this one is wrong only if the parser is wrong, in which case
 * it is showing you a real bug.
 */

interface Row {
  /** What you type. Several spellings of one idea, first is the canonical. */
  syntax: string[]
  /** Overrides the resolved value where an example would be confusing alone. */
  note?: string
}

const DATE_ROWS: Row[] = [
  { syntax: ['today', 'tod'] },
  { syntax: ['tomorrow', 'tom', 'tmr', 'tomo'] },
  { syntax: ['yesterday'], note: 'For logging something after the fact.' },
  { syntax: ['the day after tomorrow'] },
  { syntax: ['friday', 'fri'], note: 'The next one to come round. Today counts, if today is that day.' },
  { syntax: ['next friday'], note: 'That weekday in the following week.' },
  { syntax: ['this friday', 'coming friday'] },
  { syntax: ['next week'], note: 'The first day of it.' },
  { syntax: ['next month'] },
  { syntax: ['next year'] },
  { syntax: ['in 3 days'], note: 'Also weeks, months, years.' },
  { syntax: ['in 2 weeks'] },
  { syntax: ['end of month', 'eom'], note: 'The last day of it, not the first of the next.' },
  { syntax: ['end of week', 'eow'], note: 'Follows your configured first day of the week.' },
  { syntax: ['jan 27', '27 jan', 'january 27'], note: 'The next one to come round — next year if it has passed.' },
  { syntax: ['jan 27 2029'], note: 'An explicit year is taken as written, past ones included.' },
  { syntax: ['1/27'], note: 'Month first. The order is a setting.' },
]

const TIME_ROWS: Row[] = [
  { syntax: ['5pm', '5 pm'] },
  { syntax: ['5:30pm'] },
  { syntax: ['at 17:00'] },
  { syntax: ['9:05'] },
  { syntax: ['noon'] },
  { syntax: ['midnight'] },
]

const PREFIX_ROWS: Row[] = [
  { syntax: ['Pay rent by friday'], note: 'by, on, before and due attach to the date and leave the title clean.' },
  { syntax: ['Email Rosner tomorrow at 5pm'], note: 'A date and a time, in either order.' },
]

const EXAMPLES = [
  'Email Rosner tomorrow at 5pm',
  'Pay rent by friday',
  'Submit grades end of month',
  'Renew passport jan 27',
  'Draft the memo in 3 days',
  'Buy Tomorrowland tickets',
]

export default function QuickAddDocs() {
  const tz = useMemo(() => {
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone
    return isValidTimezone(browser) ? browser : DEFAULT_TZ
  }, [])

  const [text, setText] = useState('Email Rosner tomorrow at 5pm')
  const quick = useMemo(() => parseQuickAdd(text, { tz }), [text, tz])

  return (
    <div className="flex flex-col gap-12">
      {/* ── Try it ─────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <SectionHead
          title="Try it"
          sub={`Resolved live in ${tz}. This is the same parser the add-task field uses.`}
        />
        <QuickAddInput
          value={text}
          onChange={setText}
          tokens={quick.tokens}
          placeholder="Type a task…"
        />
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map(e => (
            <button
              key={e}
              onClick={() => setText(e)}
              className="text-[11px] px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700
                         text-slate-500 dark:text-slate-400 hover:border-accent-400 hover:text-accent-600
                         dark:hover:text-accent-400 transition-colors"
            >
              {e}
            </button>
          ))}
        </div>

        <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-1.5 text-sm mt-1
                       rounded-xl border border-slate-200 dark:border-slate-800 p-4">
          <dt className="text-slate-400">Title</dt>
          <dd className="text-slate-800 dark:text-slate-200">{quick.title || <Dash />}</dd>
          <dt className="text-slate-400">Due</dt>
          <dd className="text-slate-800 dark:text-slate-200">
            {quick.dueDay
              ? <>{quick.tokens.find(t => t.type === 'date')?.label} <span className="text-slate-400 font-mono text-xs ml-1">{quick.dueDay}</span></>
              : <Dash />}
          </dd>
          <dt className="text-slate-400">Time</dt>
          <dd className="text-slate-800 dark:text-slate-200">
            {quick.timeMinutes === null ? <Dash /> : formatTimeLabel(quick.timeMinutes)}
          </dd>
        </dl>
      </section>

      {/* ── Reference ──────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <SectionHead title="Dates" sub="What each spelling resolves to, right now." />
        <RefTable rows={DATE_ROWS} tz={tz} />
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead title="Times" />
        <RefTable rows={TIME_ROWS} tz={tz} kind="time" />
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead title="In a sentence" sub="Tokens can sit anywhere; the rest becomes the title." />
        <RefTable rows={PREFIX_ROWS} tz={tz} kind="full" />
      </section>
    </div>
  )
}

function Dash() {
  return <span className="text-slate-300 dark:text-slate-600">—</span>
}

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      {sub && <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function RefTable({ rows, tz, kind = 'date' }: {
  rows: Row[]
  tz: string
  kind?: 'date' | 'time' | 'full'
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row, i) => {
            // Date and time rows are fragments, so give the parser a title to
            // strip — otherwise "today" alone yields an empty title and reads
            // oddly next to the others.
            const probe  = kind === 'full' ? row.syntax[0] : `Task ${row.syntax[0]}`
            const parsed = parseQuickAdd(probe, { tz })
            const resolved =
              kind === 'time'
                ? (parsed.timeMinutes === null ? null : formatTimeLabel(parsed.timeMinutes))
                : parsed.dueDay
                  ? `${parsed.tokens.find(t => t.type === 'date')?.label} · ${parsed.dueDay}`
                  : null

            return (
              <tr
                key={i}
                className={i > 0 ? 'border-t border-slate-100 dark:border-slate-800/80' : ''}
              >
                <td className="align-top py-2.5 px-4 w-[42%]">
                  <div className="flex flex-wrap gap-1.5">
                    {row.syntax.map(s => (
                      <code
                        key={s}
                        className="font-mono text-[12px] px-1.5 py-0.5 rounded
                                   bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                      >
                        {s}
                      </code>
                    ))}
                  </div>
                </td>
                <td className="align-top py-2.5 px-4">
                  {resolved
                    ? <span className="text-slate-800 dark:text-slate-200">{resolved}</span>
                    : <Dash />}
                  {kind === 'full' && parsed.title && (
                    <span className="text-slate-400"> · title “{parsed.title}”</span>
                  )}
                  {row.note && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{row.note}</p>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
