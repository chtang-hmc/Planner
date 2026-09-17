import Link from 'next/link'
import type { Metadata } from 'next'
import QuickAddDocs from '@/components/QuickAddDocs'

/**
 * Public reference for the quick-add grammar.
 *
 * Deliberately outside the authenticated area — it documents syntax, holds no
 * data of any kind, and a page you have to log in to read is a poor place to
 * explain how to type into a box. `/help` is exempted in `src/proxy.ts`.
 */

export const metadata: Metadata = {
  title: 'Quick add syntax — Planner',
  description: 'Natural-language dates, times and repeats you can type straight into the task field.',
}

export default function QuickAddHelpPage() {
  return (
    <main className="min-h-screen bg-white dark:bg-slate-950">
      <div className="max-w-2xl mx-auto px-6 py-14 sm:py-20">

        <header className="mb-12">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent-600 dark:text-accent-400 mb-2">
            Reference
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Quick add syntax
          </h1>
          <p className="text-base text-slate-600 dark:text-slate-400 mt-3 leading-relaxed">
            Type the date into the task, the way you would say it. Whatever is recognised is
            highlighted as you type and lifted out of the title, so{' '}
            <code className="font-mono text-[13px] px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
              Email Rosner tomorrow at 5pm
            </code>{' '}
            becomes a task called <strong className="font-medium text-slate-800 dark:text-slate-200">Email
            Rosner</strong>, due tomorrow.
          </p>
        </header>

        <QuickAddDocs />

        {/* ── The rules that are not a table ───────────────────────────── */}
        <section className="mt-14 flex flex-col gap-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Things worth knowing
          </h2>

          <Note title="Days are your days">
            Dates resolve in your own timezone, not the server&rsquo;s. Typing{' '}
            <Code>tomorrow</Code> at 11pm gives you tomorrow where you are standing — which is
            not the same date as tomorrow in UTC, and getting that wrong is how an evening task
            lands a day late.
          </Note>

          <Note title="Nothing is guessed">
            Text the grammar does not recognise is left in the title, untouched. That is what
            makes the field safe to type into freely:{' '}
            <Code>Buy Tomorrowland tickets</Code> is a task about a festival, not a task due
            tomorrow, and <Code>feb 30</Code> is not quietly rounded to the 28th.
          </Note>

          <Note title="A bare number is not a time">
            <Code>at 5pm</Code>, <Code>17:00</Code> and <Code>noon</Code> are times;{' '}
            <Code>at 5</Code> is not. In <Code>Read at 5 pages</Code> the 5 is a quantity far
            more often than an hour, and silently scheduling the wrong time is worse than
            leaving it to you.
          </Note>

          <Note title="The first date wins">
            In <Code>Call mom monday about friday plans</Code> only <Code>monday</Code> is taken;
            the rest stays in the title. One task has one deadline, so the second date is almost
            always part of what the task is about.
          </Note>

          <Note title="A repeat sets its own first date">
            <Code>every monday</Code> is due the coming Monday — and typed <em>on</em> a Monday
            it means today, not a week away. An explicit date still wins, which is what makes{' '}
            <Code>every day starting friday</Code> mean what it says.
          </Note>

          <Note title="A time sits beside the day, never inside it">
            <Code>tomorrow at 5pm</Code> stores the day and the hour separately. Folding 5pm
            into the date would make the task read as due the <em>following</em> day for
            anyone west of UTC, so the hour is kept as a wall-clock time — it still means 5pm
            after you move or the clocks change. The scheduler doesn&rsquo;t yet treat it as a
            fixed appointment; it shows on the task and the day is what drives urgency.
          </Note>

          <Note title="every! restarts the clock when you finish">
            <Code>every 3 days</Code> counts from the due date, so falling a fortnight behind
            hands you back a date already in the past — right for rent, wrong for plants.{' '}
            <Code>every! 3 days</Code> counts from when you actually finished, so the next one
            is three days from now however long the last gap was. Everything else about the
            repeat is identical.
          </Note>
        </section>

        {/* ── Not yet ──────────────────────────────────────────────────── */}
        <section className="mt-14">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">
            Not yet
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
            Planned, and not currently recognised — these stay in the title if you type them.
          </p>
          <ul className="flex flex-col gap-2.5 text-sm">
            {[
              ['#project', 'File it as you type.'],
              ['p1 – p4',  'Priority.'],
              ['for 45m',  'An estimate.'],
            ].map(([syntax, what]) => (
              <li key={syntax} className="flex gap-3">
                <Code>{syntax}</Code>
                <span className="text-slate-500 dark:text-slate-400">{what}</span>
              </li>
            ))}
          </ul>
        </section>

        <footer className="mt-16 pt-6 border-t border-slate-200 dark:border-slate-800">
          <Link
            href="/tasks"
            className="text-sm text-accent-600 dark:text-accent-400 hover:underline"
          >
            ← Back to Planner
          </Link>
        </footer>
      </div>
    </main>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-[12px] px-1.5 py-0.5 rounded whitespace-nowrap
                     bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
      {children}
    </code>
  )
}

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-slate-200 dark:border-slate-800 pl-4">
      <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">{title}</h3>
      <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{children}</p>
    </div>
  )
}
