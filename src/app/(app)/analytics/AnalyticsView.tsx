'use client'

/**
 * Insights.
 *
 * Three findings, the division of what is left, and an honest account of what
 * is not known yet. Nothing here is a chart for its own sake: the page that
 * came before drew an accuracy donut from four samples, a histogram whose one
 * finding is now a card, and five energy bars between 2.0 and 3.0 — pictures
 * of data too thin to carry one.
 *
 * A page with one card on it is telling the truth about how much it knows.
 */

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { formatMinutes } from '@/lib/task-format'
import type { Finding } from '@/lib/insights'
import type { ProjectRow } from '@/lib/projects'
import type { ThinData as ThinDataModel } from '@/lib/thin-data'
import { FindingCard } from '@/components/ds/Finding'
import { WorkloadTable } from '@/components/ds/WorkloadTable'
import { ThinData } from '@/components/ds/ThinData'

interface Props {
  findings:      Finding[]
  rows:          ProjectRow[]
  workload:      string | null
  totalMinutes:  number
  activeCount:   number
  doneAllTime:   number
  panels:        { label: string; data: ThinDataModel }[]
}

export default function InsightsView({
  findings, rows, workload, totalMinutes, activeCount, doneAllTime, panels,
}: Props) {
  const router = useRouter()

  return (
    <div className="min-h-full bg-surface-sunk">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur">
        <div className="px-6 py-3 flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <h1 className="display text-display-m text-ink leading-tight">Insights</h1>
            <p className="text-meta text-ink-muted mt-0.5">
              {activeCount} active task{activeCount === 1 ? '' : 's'} ·{' '}
              <span className="num">{formatMinutes(totalMinutes)}</span> left ·{' '}
              {doneAllTime} completed all time
            </p>
          </div>
          {/* Review's permanent entry point. It is a weekly ritual rather than
              a daily destination, so it does not earn a nav slot — but acting
              on findings is what it is for, which makes this its home. */}
          <Link href="/review"
                className="text-meta font-semibold text-accent-600 hover:underline underline-offset-2">
            Weekly review →
          </Link>
        </div>
      </header>

      <div className="px-6 py-4 flex flex-col gap-4">
        {findings.length > 0 ? (
          <div className="grid grid-cols-1 mid:grid-cols-2 wide:grid-cols-3 gap-3 items-stretch">
            {findings.map(f => (
              <FindingCard key={f.key} finding={f} onAct={href => router.push(href)} />
            ))}
          </div>
        ) : (
          /* Not an error, and not an empty state to apologise for. Three
             findings that each need a number, and none of them had one today. */
          <div className="rounded-xl border border-line bg-surface px-4 py-5">
            <p className="text-meta text-ink-2">Nothing stands out today.</p>
            <p className="text-micro text-ink-muted mt-1">
              Today fits, the urgency scores are still sorting, and no project has run away
              with the workload. This page only speaks when it can name a number.
            </p>
          </div>
        )}

        <WorkloadTable
          rows={rows}
          total={totalMinutes}
          finding={workload}
          onOpen={id => router.push(id ? `/projects/${id}` : '/tasks')}
        />

        <section className="rounded-xl border border-line bg-surface p-4 flex flex-col gap-4">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h2 className="text-eyebrow uppercase tracking-wider text-ink-faint">Not enough data yet</h2>
            <p className="text-small text-ink-muted">These stay hidden until they would mean something.</p>
          </div>
          <div className="grid grid-cols-1 mid:grid-cols-3 gap-5">
            {panels.map(p => <ThinData key={p.label} label={p.label} data={p.data} />)}
          </div>
        </section>
      </div>
    </div>
  )
}
