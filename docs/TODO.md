# TODO

Standing context that does not belong in an issue: accepted costs, known thin
spots, and work that has shipped but has never actually been run.

**Discrete work goes in GitHub Issues, not here.** If someone could pick it up
and finish it, it is an issue. This file is for the things that are true about
the project rather than things to do — the distinction matters because two
trackers that overlap is how one of them quietly stops being updated.

---

## Rules for this file

These exist because this file misled a session on 2026-09-17: three of its
factual claims had gone stale, and acting on them produced a wrong duplicate
count and a fix that would have broken what it was fixing.

1. **Every factual claim carries the date it was checked.** A number without a
   date is a rumour. `energy_patterns is empty` was true when written and false
   three weeks later, but nothing in the text said so.

2. **An entry is a lead, not a finding.** Re-verify before acting on it, and say
   in the PR how you verified. Twice in one session an entry understated its
   own problem: "two UTC-slice bugs" turned out to be four, and one of the two
   had a matching bug on the server that fixing the client alone would have
   exposed.

3. **Delete when done, and check the neighbours.** When you finish something,
   remove it — and while you are in the area, look at whether any other entry
   about it has just become wrong. Most staleness here was collateral: an entry
   nobody touched, describing code somebody did.

4. **If it becomes actionable, move it to an issue and delete it here.** Do not
   leave a pointer behind; a line saying "see #24" is another thing to keep in
   sync.

---

## Shipped but never run for real

Covered by tests, live on `main`, and not yet exercised against the real
calendar or a real week. Worth knowing when something behaves oddly.

### The scheduler's deadline now bounds the end of a block

Until 2026-09-17 the placement loops compared a candidate's *start* to the
deadline. That was the same test while deadlines were always end-of-day, and
wrong the moment `due_time_minutes` made them mid-day — a 90-minute session
starting at 9 against an 11am deadline began in time and finished late.

Three sites changed, including the fixed-offset sequence where the *last* stage
is what has to land in time. The next "Schedule week" is the first live run.

### `every!` — recurrence anchored on completion

`completeTask` anchors on the completion day rather than the due date when
`rrule_from_completion` is set. Works in tests; no task uses it yet. It only
proves itself when something recurring is finished late.

---

## Thin data, not broken charts

*Checked 2026-09-17.* `energy_patterns` 2 rows, `energy_logs` 4,
`focus_sessions` 9.

The pg_cron jobs are running now, so these will fill on their own. Until they
do, most of Analytics is drawn from single-digit sample sizes — worth knowing
before concluding a chart is broken.

---

## Standing costs, accepted deliberately

### Four row layouts means four implementations

Every feature touching a task row is built four times. `TaskRowProps` makes the
compiler point at whichever layout has not handled a new field, and anything a
layout skips is declared in its `omits` list — but the work is still 4×.
Revisit if adding a row feature starts to feel expensive.

### Tests stop at the database

`npm test` covers the pure logic: the scheduler, urgency, relevance, the
quick-add grammar, and the date helpers in `lib/day` and `lib/week`. Nothing
touching Supabase or Google Calendar is tested, because faking two external
services costs more than it currently returns.

That is why anything writing to a real calendar wants a deliberate manual run
before it is trusted, and why "verified against the live database" appears in
so many PR descriptions — it is standing in for a test that does not exist.
