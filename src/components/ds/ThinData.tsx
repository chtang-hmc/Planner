/**
 * "Not enough data yet", as a promise.
 *
 * One component for every place the app is waiting on samples — a project's
 * estimate accuracy now, Insights' cross-project panel next — so the two
 * cannot end up phrasing the same idea differently. The bar makes "nearly
 * there" visible, which a bare `1 / 3` does not.
 */

import type { ThinData as Model } from '@/lib/thin-data'

export function ThinData({ label, data }: { label: string; data: Model }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-3">
        <h3 className="text-eyebrow uppercase tracking-wider text-ink-faint">{label}</h3>
        <span className="flex-1" />
        <span className={`num text-micro ${data.ready ? 'text-ok' : 'text-ink-2'}`}>
          {data.have} of {data.unit}
        </span>
      </div>

      <div className="h-[5px] rounded-full bg-track overflow-hidden flex">
        {data.ratio > 0 && (
          <div style={{
            width: `${(data.ratio * 100).toFixed(1)}%`,
            background: data.ready ? 'var(--ok)' : 'var(--ink-faint)',
          }} />
        )}
      </div>

      <p className="text-micro text-ink-muted leading-relaxed">{data.unlocks}</p>
    </section>
  )
}
