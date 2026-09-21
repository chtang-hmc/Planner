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

### Home's "Block today" has never written to a real calendar

*Checked 2026-09-19.* The page itself was verified against the live database —
today's six events, three gaps, the suggestions and the two attention rows all
came out right — but that path is read-only. The button runs
`proposeSchedule(1, …)` and `confirmSchedule`, which is the same code
"Schedule week" uses, so the risk is in the one-day window rather than in the
write. First real click is the first real test.

### `every!` — recurrence anchored on completion

`completeTask` anchors on the completion day rather than the due date when
`rrule_from_completion` is set. Works in tests; no task uses it yet. It only
proves itself when something recurring is finished late.

---

## Thin data, said out loud

*Checked 2026-09-21.* `energy_patterns` 9 rows, `energy_logs` 11 across 6
distinct days, `focus_sessions` 18 of which **5 carry a reflection**,
`estimation_profiles` 6 rows of which **3 clear the 3-sample threshold**.

This used to be a warning that Analytics was drawing charts from single-digit
samples. It no longer is: #71 deleted the three charts that did that, and
Insights now states the sample counts in words through `ThinData` — "4 of 12
reflections", "1 of 7 projects" — with a line saying what arriving unlocks. The
numbers above are what that panel reads.

The pg_cron jobs are running, so these fill on their own. Nothing here is
broken; the page simply knows less than it eventually will, and now says so.

---

## Standing costs, accepted deliberately

### `/projects` fetches every task ever, at every status

`buildProjectRows` needs the completed tasks — progress is
`done / (active + done)`, and "stalled" is measured from the last completion —
so the page reads the whole `tasks` table rather than the open ones. 71 rows on
2026-09-21, which is nothing; it grows by one per completion and never shrinks.

Accepted because the app is single-user and the alternative is two aggregate
queries that would have to keep agreeing with `buildProjectRows` in
application code. Worth revisiting somewhere in the low thousands of rows, or
sooner if the page feels slow.

### Tests stop at the database

`npm test` covers the pure logic: the scheduler, urgency, relevance, the
quick-add grammar, and the date helpers in `lib/day` and `lib/week`. Nothing
touching Supabase or Google Calendar is tested, because faking two external
services costs more than it currently returns.

That is why anything writing to a real calendar wants a deliberate manual run
before it is trusted, and why "verified against the live database" appears in
so many PR descriptions — it is standing in for a test that does not exist.
