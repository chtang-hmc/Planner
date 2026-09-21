/**
 * A finding: a number, the evidence for it, and somewhere to go about it.
 *
 * The display face is used here because this is a claim — the one place on the
 * page where a sentence is the content rather than a label. Never rendered
 * without a number in it: `lib/insights` returns null instead of a hedge, so
 * a card that exists has something to say.
 */

import type { Finding as Model } from '@/lib/insights'

export function FindingCard({ finding, onAct }: {
  finding: Model
  onAct?:  (href: string) => void
}) {
  const { label, headline, evidence, action, urgent } = finding

  return (
    <article className="rounded-xl border border-line bg-surface p-4 flex flex-col gap-2 min-w-0">
      <span className="flex items-center gap-2">
        <span aria-hidden className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: urgent ? 'var(--danger)' : 'var(--ink-faint)' }} />
        <span className="text-eyebrow uppercase tracking-wider text-ink-faint">{label}</span>
      </span>

      <h3 className="display text-display-xs text-ink leading-snug text-balance">{headline}</h3>

      <p className="text-meta text-ink-muted leading-relaxed flex-1">{evidence}</p>

      <a
        href={action.href}
        onClick={onAct && (e => { e.preventDefault(); onAct(action.href) })}
        className="text-meta font-semibold text-accent-600 hover:underline underline-offset-2 self-start"
      >
        {action.label}
      </a>
    </article>
  )
}
