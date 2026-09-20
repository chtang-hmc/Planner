# Decisions — answers to the 2026-09-20 implementation review

**This file supersedes `DESIGN-SPEC.md` wherever they disagree.** The spec is
still the description of the design; this is the record of what was decided
after review. `tokens.css` is at revision 2 and is authoritative for colour.

Thank you for re-measuring rather than quoting. Three of these questions found
real mistakes in the handoff, not ambiguities: the urgency legend (E1), the
lightness-encoded capacity bar (A1), and a capacity band with only one state
(E3). Those are on me.

New on the canvas: **Triage**, and four screens at 390px — Today, Tasks·List,
Upcoming, Projects.

---

## A. Blocking

### A1 — Dark mode: take your third option, and fix the light palette too

**Decision: warm paper ships as a tenth accent preset. No hand-built dark
palette. But the convergence gets fixed in light mode regardless, because it
was a flaw whether or not dark exists.**

Your measurement is right and the diagnosis is better than mine. Five signal
colours inside 37° of hue, separated only by lightness against an L=97 ground,
is a palette that works in exactly one theme. That is a bad palette even if we
never ship dark.

The fix is not to re-pick five hues. It is to need fewer.

**`--warn` and `--caution` are deleted.** They existed to colour the urgency
meter in four bands. But the meter's *fill length* already encodes the score,
so the colour was redundant with the length, and the list is sorted by the same
number anyway. Three encodings of one variable, and the third one cost four
hues and made a theme impossible.

Urgency is now a single neutral fill whose length is the score. The only
categorical state that keeps red is **overdue**, carried by the row's text.

That leaves three signal colours — `--accent` (17), `--danger` (5), `--ok`
(122) — and it dissolves the rest:

- `--p-jobs` / `--warn` and `--p-public-policy` / `--caution` collisions: gone,
  the colliding tokens no longer exist.
- Project colours in dark: they come from your generated ramp under the
  preset, so they are your existing problem with your existing solution.
- **The capacity bar no longer encodes state in lightness.** Three segments,
  three different encodings: solid `--ok`, a 45° hatch of `--ok` on
  `--ok-tint`, solid `--danger-fill`. A hatch survives any re-tint. There is a
  `.capacity-late` class in `tokens.css`.

So: light-mode identity through the preset, dark mode keeps every one of your
1,051 `dark:` utilities working, and the thing that would have broken in dark
gets fixed in light as well.

### A2 — Narrow

Drawn rather than described. Four boards on the canvas at 390px, and
`--bp-narrow` / `--bp-mid` / `--bp-wide` are in `tokens.css`.

**1. Task row → two lines, 56px, no fixed columns.**

```
[checkbox 15] [dot 7] │ title, one line, ellipsis
                      │ PROJECT · duration · state
```

You are right that this deletes the property the wide row exists for. So
accept that and delete it cleanly rather than compressing. Two things follow:

- **The urgency meter does not appear narrow.** A1 makes this free — the meter
  was already redundant with sort order.
- The meta line is the only place `PROJECT` and duration live, and duration
  stays mono so the second lines still align down the list.

**2. Week strip → seven days with a pager.** Not scroll, not a sparkline.
Horizontal scroll hides half the argument behind an invisible affordance, and
the argument *is* the comparison across days. A sparkline loses the per-day
read, which is the only reason to tap. Seven columns at 390 gives ~50px each:
two 8px bars, 3px apart, a date, and a 44px tap target. `‹ 20 — 26 Sep ›` above.

**3. Project table → four of nine columns.** Priority order for shedding:

| rank | column | ≥1200 | 900–1200 | 640–900 | <640 |
|---|---|:--:|:--:|:--:|:--:|
| 1 | name | ● | ● | ● | ● |
| 2 | time left | ● | ● | ● | ● |
| 3 | status chip | ● | ● | ● | ● |
| 4 | progress bar | ● | ● | ● | ● (64px, no %) |
| 5 | next due | ● | ● | ● | ○ meta line |
| 6 | active count | ● | ● | ○ | ○ |
| 7 | share of time | ● | ○ | ○ | ○ |
| 8 | progress % label | ● | ● | ○ | ○ |
| 9 | chevron | ● | ● | ● | ● (row is the link) |

Share of time goes first because it is the one column that is only meaningful
against the whole table, and the whole table stops being visible at once.

**4. Today narrow.** Committing, as asked: the timeline wins and takes full
width. The capacity band stays above it — it is the point of the screen and it
compresses to a card with a stacked legend and one full-width Triage button.
The unplaced rail becomes a bottom sheet with a persistent handle showing
`UNPLACED · 10 · 10h 50m`, sitting above the tab bar. Habits drop off Today
entirely at narrow and live on the Habits tab. Energy shrinks to five 13px bars
beside the date.

The sidebar becomes a five-item tab bar below `--bp-narrow`. Review and
Settings move behind the Projects tab's overflow.

### A3 — Triage

**It is one modal, with three entry points and no screen of its own.**

It is a decision flow, not a browsing surface. What it shows: the tasks the
packer could not place today, largest first. What you do: for each one,
`Tomorrow` / `Someday` / `Keep`, with `···` for pick-a-day, shrink the estimate,
and delete. Decided rows stay in place, dimmed and struck through, with the
consequence spelled out (*moving to Monday 21 · lands in the 4pm block*) and an
Undo. Nothing is written until **Apply**.

The deficit is the progress bar. The header counts down live — *2h 35m still
needs to leave today* — and the meter at the top fills green as you clear it.

Note the two numbers on the board, both correct and deliberately both shown:
the deficit is **5h 35m** (due minus free) but **six tasks totalling 5h 50m**
could not be placed, because gaps fragment. The copy says so: *deciding on any
5h 35m of them clears the day*.

Three entry points, one component:

| from | preselection |
|---|---|
| Today, capacity band | today's unplaceable tasks |
| Tasks·List, Overdue group header (*Reschedule all*) | the overdue tasks |
| Insights, Urgency card (*Rebalance due dates*) | every task scoring >60, across all dates |

That resolves three of the D-table questions as well.

---

## B. Palette and tokens

### B1 — Yes. In `tokens.css` rev 2

All eight projects have `--p-x`, `--p-x-tint`, `--p-x-shade`. Added
`--bar-free` (#D9E3D9), `--today-fill` (#FBF7F0) and `--today-edge`.
`--accent-wash` is deleted. Also added `--accent-tint` / `--accent-ink` for
the active filter chip, and `--ok-tint` / `--danger-tint`.

### B2 — Confirmed: `tokens.css` is the source of truth

The reference files are pictures of the design, not an implementation of it.
Where they disagree with the token file, the token file wins.

**Known drift, flagged rather than hidden:** the five new boards use the
revision-2 urgency meter (neutral fill). The seven older boards still show the
four-colour meter from revision 1. They predate A1 and I have not re-rendered
them. Build to the token file.

### B3 — Drop IBM Plex Sans. Two families, one of them new

You are right that three families undercuts the argument. Keep Geist and Geist
Mono for UI and numerals; add Instrument Serif for claims only. It loads four
sizes at one weight with no italic, and it appears on roughly one line per
screen.

Check one thing before committing: Geist Mono needs tabular figures on by
default (`font-variant-numeric: tabular-nums`) or the duration columns will
not align, which is the whole reason a mono is specified.

---

## C. Data

### C1 — "Semester week 4" is flavour. Cut it

Not worth an academic calendar. The subhead keeps only the overdue line.

### C2 — Yes, "due Friday and still open". Reword it

Your reading is correct, and the wording implied history it does not have. It
now reads **"Overdue since Friday"**, which is exactly what is computable.

### C3 — Today only for now. The snapshot table is the first thing after step 4

Correct that it is the most expensive sentence in the handoff, and correct not
to build it on spec. The Capacity finding card claims today only.

But I would not drop it permanently. *"The fourth day running"* is the only
claim in the redesign that could change behaviour rather than describe it, and
the table is small:

```
daily_capacity(date PK, due_minutes, free_minutes, completed_minutes, deficit_minutes)
```

One nightly row. Put it in immediately after step 4 so that by the time
Insights is built there are two weeks of history to read.

### C4 — Read from the linked calendar event. No new field

Depends on habit↔event linking, which is already specified. Unlinked habits
show no time; the cadence line is just `Daily · 60m`.

### C5 — Compute it, with a floor

`completed_at <= due_date` across past occurrences. For a recurrence with no
due date, the occurrence is late if it is logged after its cadence window
closes — end of day for daily, end of week for weekly. **Show the line only
after four occurrences**; below that it is the thin-data problem wearing a
sentence. Under four, show nothing rather than a hedge.

### C6 — The confirmation is an inline chip, not a screen

Three states on the event's own timeline row:

| state | what renders |
|---|---|
| suggested | `Covers "Prep for Big E&M Tutoring"?` on `--accent-tint`, with a ✓ and ✗ button pair, 24px |
| confirmed | the static `covers 1 task` chip on `--ok-tint`, already in the reference files |
| rejected | nothing, and the pair is never suggested again |

Only one suggestion renders per day at a time, on the highest-confidence match,
so the timeline never becomes a queue of questions. Confirmed and rejected
links are listed in Settings for editing. Until a match is confirmed, the task
counts toward `dueTotal` — never silently deduct on a guess.

Agreed these are features and not helpers, and they should be sequenced as
such: task↔event linking is a prerequisite for `capacity()` being correct, so
it lands in step 3, not later.

### C7 — One definition everywhere, Inbox included

`done% = done / (active + done)`, excluding cancelled and excluding subtasks.
No reason for the Inbox pseudo-project to be exempt; it has completed tasks in
its history like anything else. The `—` in the reference is wrong.

---

## D. Actions

| control | decision |
|---|---|
| **Plan the day** | The existing propose-and-write-to-calendar flow. Nothing new. Use whatever it is called today; do not rename it to match my label. |
| **Push to tomorrow** | Triage with everything preset to Tomorrow, still requiring Apply. Only the tasks that do not fit. Changes **due dates**, not scheduled times. |
| **Fill automatically** | *Plan the day* scoped to one slot. Same flow, one gap. |
| **Reschedule all** | Opens Triage with the overdue tasks preselected. Never a silent bulk write. |
| **Rebalance due dates** | Opens Triage over every task scoring >60, all dates. |
| **7m** | That was meant to be "synced 7 minutes ago" and it is indefensible as a bare number. Give it a label or move it to the Settings row. My error. |

### D1 — Energy

**The header control writes the self-report log for today. It does not touch
the per-block schedule.** Two concepts, and the header one is the log.

**"Fits my energy" filters the task's `low|medium|high` requirement against
today's logged level**, showing tasks whose requirement is at or below it.

On replacing four-way with a boolean: half deliberate, and you are right to
push. The boolean is the right *default* because "what can I actually do right
now" is the question people have. But losing the explicit override is a
regression. Keep both: the chip is a toggle, and long-press or the chip's own
dropdown exposes Any / Low / Med / High. Default on, computed from the log.

---

## E. Conflicts

### E1 — The legend is wrong. It is a description, not a proposal

My error, written from a model of the formula I had not checked. Do not change
the formula.

New legend: **"Urgency combines priority with how close the deadline is."**

And the removal of creation date was right. Two tasks with the same priority
and deadline scoring differently because one was typed in earlier is a bug, not
a feature, and the comment says so better than I would.

Keep the **How urgency is scored** link. The redesign leans on the score
harder than the current UI does — it sorts the unplaced rail and drives the
Rebalance entry point — so it earns an explanation. It is new work; size it as
a help page, not a feature.

### E2 — Confirmed: it is a filter

Good news accepted. The projects list view excludes `parent_id IS NOT NULL`.
No data-model change.

### E3 — Confirmed, and your reading caught a gap

Yes: the recommendation survives, distributed into the free slots, and the
standalone card goes. *"Two tasks fit exactly"* and *"best window before Piano"*
are the recommendation, per slot, with the ranking you already have.

What your reading exposes is that **I only designed the over-capacity state.**
On a day that fits, a band that says "5h 35m will not fit" has nothing to say.
The capacity band needs three:

| state | headline | supporting line | primary action |
|---|---|---|---|
| over capacity | *5h 35m of today's work will not fit.* | due / free / when the free time is | Triage *Xh YYm* |
| fits, with slack | *Everything due today fits, with 2h 10m spare.* | the recommendation — what to start and in which gap | Start *[task]* |
| nothing due | *Nothing is due today.* | what is nearest, and how much free time there is | Pull work forward |

The third state is where the old "Do this now" recommendation is most useful
and where the redesign was silent. Not drawn yet; say the word and I will.

---

## F. Internal inconsistencies

### F1 — The spec is right, the markup is behind

Inbox belongs in the sidebar. Combined with G2: it renders in the sidebar, the
table and the Insights callout **only when non-empty**. The reference files
predate that and show seven projects; build to the spec.

### F2 — One rule: the right-hand value always carries a noun

Two denominators in one component is a bug. The panel always counts *samples
toward a threshold*, and the label always names the unit:

- Project detail: `3 samples · 1 of 3` → reads as samples.
- Insights, cross-project: `1 of 7 projects ready`.

The word `projects` is what makes the second one unambiguous. Bare `1 / 7` is
never acceptable in this component.

### F3 — One definition, and the totals must reconcile

```
active = open AND NOT someday AND parent_id IS NULL
```

Everywhere. Header counts, project rows, Inbox row, Insights. If the per-project
sum does not equal the global count, that is a bug to fix rather than a
difference to explain. The 26 came from the original screenshots and should not
be treated as a target.

### F4 — Streak is counted in the habit's own cadence unit, and the cell always shows it

`12d` for a daily habit, `2w` for a weekly-target one. The header stays
`STREAK`; the unit lives in the cell, always, which is what makes the column
readable. A streak for a 2×/week habit means consecutive weeks hitting the
target, and that is the only sensible reading.

`1/—` is wrong. A habit with no target shows a **plain count**, `1`, not a
fraction with an empty denominator.

### F5 — Follow the setting

Monday was an accident of drawing. The grid's first column is the configured
first day, and the column letters derive from it.

---

## G. The two raised points

### G1 — Agreed, tighten it

A rule that fires on two of seven is a description, not a flag. New rule:
**the single largest project, and only when its share is ≥ 35%.** At most one
concentration chip in the table. On today's data that is Research at 44% and
Public Policy drops out, which is the right answer.

### G2 — Both good catches

**Inbox.** It renders only when non-empty — row, sidebar entry, Insights
callout, all three. When it is empty that is a small quiet win and the UI
should not manufacture an alarm about it. The design still needs the affordance
because tasks will land there again.

**Nesting is the more important case and I got it wrong.** Containment is not
a conflict. An event fully inside a longer one is usually intentional — a
meeting inside a blocked-out working session — and flagging it would train you
to ignore the chip.

Two different things, handled differently:

| pattern | treatment | effect on `capacity()` |
|---|---|---|
| **Overlap** — partial, staggered, neither contains the other | conflict chip on the earlier event, both rows tinted, count in the day header | the union counts once |
| **Containment** — one entirely inside another | no chip. The inner event renders indented under the outer | **the inner event's minutes are not subtracted twice** |

That second column is the real bug, not the chip. Double-subtracting a nested
event makes `capacity()` under-report free time, which would have shipped
silently and made the headline number wrong. Good find.

On the stale examples generally: the reference files are a photograph of one
day and will keep drifting. Build against the rules, not the numbers.

---

## Your seven assumptions

| # | verdict |
|---|---|
| 1 | Yes. Steps 1–4 proceed. One change: task↔event linking (C6) moves into step 3, because `capacity()` is wrong without it. |
| 2 | Yes, with A1's additional light-mode fix. |
| 3 | Yes, and reword to "Overdue since Friday". |
| 4 | Yes, and add `daily_capacity` immediately after step 4 so history exists by the time Insights is built. |
| 5 | Yes. New wording in E1. |
| 6 | Yes, all three surfaces. |
| 7 | Partly. Upcoming and Projects need A2, which is now answered and drawn. List needs nothing further — start it whenever step 5 comes up. |

---

## Still open, and on me

- The **capacity band's other two states** (E3), not drawn.
- **Habits and Insights at narrow.** Habits survives narrow cleanly per your
  own measurement; the 28-dot strip at 390 needs checking, and the 5×7 week
  grid probably wins over the dot strip at that width.
- **Focus states** across everything.
- **The Review screen**, which no version of this has touched.

---

# Round 2 — answers to the follow-up questions

Recorded 2026-09-20 from the designer (1–6) and the project owner (7–10).
Same standing: this supersedes `DESIGN-SPEC.md` where they disagree.

## 1 — Energy: label it, and the tap targets fail too

At narrow the bars stop being the control. It becomes a **34px chip reading
`Energy 3/5`** with three small filled bars inline, in the same chip language as
the filter row, opening a five-option sheet on tap. Label visible, one tap.
Fall back to restoring the `ENERGY TODAY` eyebrow if the chip does not land.

**The wide control fails the 34px minimum too** — its shortest segment is 22×12.
Keep the stepped bars visually and give each button a transparent 34px-tall hit
area.

## 2 — Settings is a gear in the page header. Review is not a tab

Settings was never a peer of Today and Tasks; it is a gear top-right of the page
header on every screen. Retracted from the tab bar entirely.

Review also stays out — five is the comfortable maximum at 390px and
Today/Tasks/Habits/Projects/Insights each earn a slot. Review is a weekly
ritual, not a daily destination, so it gets two entry points: a permanent link
at the top of Insights, and a banner on Today on the day it is due.

**Caveat, unresolved:** the designer has never seen the Review screen. If it
turns out to be substantial it takes the Insights slot and Insights becomes a
section inside it — findings and the weekly ritual of acting on findings being
the same surface at two cadences.

## 3 — No range control on Insights until `daily_capacity` exists

A three-way range picker with no history is three buttons where two lie. Drop
it; no control and no implied windows.

Once history lands, the page splits: a **Today band** at the top carrying the
capacity state, outside the range control entirely because that is the state of
the day and not a statistic; below it a **ranged section** holding the findings
and the workload table, where the range **recomputes** the findings rather than
re-scoping the same three. A finding with no data in the selected window does
not render. *This week* yields "you went over on 4 of 7 days"; *All time* yields
composition claims. Different sentences, not the same ones at different zoom.

## 4 — `Pull forward 1h 20m`, as a text link, with guards

Not a deliberate blank. The inverse of Triage: on a day with slack the action
opens the same component running backwards — tasks due later that fit the
slack, accept or skip, one Apply.

Two constraints, because a productivity app that fills every gap is a machine
for burning people out:

- it only ever offers tasks **already due within seven days**, never Someday
- it is **always a text link**, never the filled primary button, so the default
  is that you keep your slack

If the slack is smaller than the smallest eligible task the slot is genuinely
blank, and blank is right.

## 5 — Day off is a fourth state, and it has no bar

A day off with work due on it is a scheduling error worth surfacing, but not as
a deficit: the bar encodes a ratio against free time, and with no free time it
is a 100% red block carrying no information. So the bar goes.

- headline `Today is a day off.`
- supporting line `11h 10m is still due today.` — only when something is
- actions `Move it all to Monday`, and `Work anyway`, which enables hours for
  today only
- if nothing is due, it says so and stops. That is the one screen in this app
  that should be quiet.

## 6 — Free time is only asserted when something asserts it

**Zero events is not a free day, it is an unknown day**, and the design could
not tell the difference. Same family of bug as the nested-event
double-subtraction.

The rule, three sources in priority order:

| source | behaviour |
|---|---|
| a connected calendar | capacity as designed |
| manually-entered working hours, no calendar | capacity works, but **labels its source** — a day full of untracked meetings will otherwise be confidently wrong |
| nothing | **no free-time claim anywhere**: no capacity bar, no free slots on the timeline, no "fits" language, and the week strip shows due bars with no free bars behind them |

First run reads `Planner can't see your day yet.` /
`Connect a calendar and this becomes how much of today's work actually fits.`
with `Connect calendar` primary and `Set working hours instead` secondary. The
timeline shows the tasks listed rather than placed.

**The capacity band therefore has five states**, not one: unknown, day off, over
capacity, fits with slack, nothing due. Four of them are not drawn yet.

## 7–10 — Owner decisions

| # | question | decision |
|---|---|---|
| 7 | Drag-to-reschedule in the first Upcoming? | **Yes, include it.** Step 6 ships with it. |
| 8 | Does `daily_capacity` backfill? | **No — history starts the day it ships.** Which is the argument for landing it right after step 4. |
| 9 | Habit↔event linking has no step | Accepted; it needs placing in the order. |
| 10 | Triage `Apply` on partial failure | Left to implementation. **Matching `confirmSchedule`: report partial success, do not roll back.** Several independent row updates with no transaction wrapper, and a half-applied triage the user can see and finish beats a silent revert of decisions they already made. |

## Still open after round 2

- The **four undrawn capacity-band states** (unknown, day off, fits with slack,
  nothing due). The designer has offered to draw them.
- **Review**, and whether it absorbs Insights (see 2).
- Habits and Insights at narrow; focus states.
