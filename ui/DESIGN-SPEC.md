# Planner — UI redesign spec

Handoff for implementation. Everything here describes a target state; nothing
assumes a particular framework.

## What is in this folder

```
DESIGN-SPEC.md      this file — read it first
tokens.css          the design tokens as CSS custom properties
reference/
  today.html            Home / Today
  tasks.html            Tasks · List view
  upcoming.html         Tasks · Upcoming view
  projects.html         Projects overview
  project-detail.html   Inside one project (Clinic)
  habits.html           Habits
  insights.html         Analytics, rebuilt
```

The seven HTML files are static, self-contained and open in a browser. Their
nav links work, so you can click through the whole thing. They are **visual
reference, not code to ship**. Every value is an inline style so exact
colours, sizes and spacings can be read straight out of the markup. Port the
values into real components using `tokens.css`; do not paste inline styles
into the app.

Each page is drawn at 1440px wide. Nothing below 1440 is designed yet — see
*Not covered*.

---

## The one idea

The app already collects estimates, energy levels and calendar events, and it
already computes free gaps. It then presents everything as a flat list sorted
by due date, so the time data never reaches the user as a conclusion.

On the reference day: **10h 50m of work is marked due against 5h 15m of free
calendar, and 3h 30m of that free time starts at 10pm.** The app has every
number needed to say that. The redesign says it, on Home, first, above
everything else. Every other screen carries a piece of the same idea.

If a change conflicts with that idea, the idea wins.

---

## Typography and numbers

Three faces, each with one job.

- **Instrument Serif** — claims only. Page titles, the capacity sentence, a
  finding headline. Never a label, never a control, never a table cell.
- **IBM Plex Sans** — all UI text.
- **IBM Plex Mono** — *every* duration, clock time, count and percentage,
  without exception. This is the rule that makes columns of numbers scannable.
  `1h 00m`, not `1h`. Pad so widths match.

Durations always render as `Xh YYm` or `YYm`. Never mix `1h` and `1h 15m` in
the same column.

The current build has effectively one type size and one grey. The scale in
`tokens.css` has four display sizes and six text sizes; use them, and let
weight do less work than size.

---

## Components

### Task row — 44px

```
[checkbox 15] [project dot 7] [title, grows] [state chip?] [urgency meter 34×4] [PROJECT 84, right] [duration 52, mono, right]
```

Used on Tasks·List, project detail and the project table's expanded rows. The
right-hand columns are fixed widths so they form real columns down the list.

- Divider is `--line-soft` on the top edge, not a card per row.
- Title truncates with ellipsis; it never wraps.
- **Do not** put a "TODAY" badge on a row inside a group headed "Today". The
  current build does this on every row and it is pure noise. State chips carry
  only what the group header does not: `scheduled 4:00pm`, `repeats weekly`,
  `3 steps`, `2 DAYS LATE`.
- Urgency is a 34×4 meter coloured by band, never a bare number.

### Group header — with capacity

```
[Label, 12px 700] [count · total, mono] [capacity meter 110×6] [verdict] ... [action link]
```

Two segments: time that fits (`--ok` or `--ok-soft`) and time that does not
(`--danger-fill`). The verdict reads `4h 35m over capacity` in `--danger`, or
`fits, 1h 20m to spare` in `--ok`. A group with no due date gets no meter.

### Timeline entry — Today, 48–84px

```
[time 52, mono, right] [rail 3px, project colour] [content]
```

The rail is a continuous coloured bar, not a card border. Heights are roughly
proportional to duration (1h ≈ 48px, 2h ≈ 62px, 3h ≈ 84px); exact
proportionality makes the page too tall, so compress but keep the ordering
visible.

### Day row — Upcoming, 34px

The compressed cousin of the timeline entry, for when several days are on one
screen.

```
[time 46, mono, right] [rail 3px, 18px tall] [title, grows] [chip?] [duration 56, mono, right]
```

A free slot swaps the solid rail for `border-left: 3px dashed --line-dash` and
puts the duration in `--accent` semibold on the left, with a one-line reason
beside it.

### Free slot — Today, expanded

Dashed `--line-dash` box containing the duration in `--accent`, a one-line
reason, and chips for the tasks that fit, each `[dot] [title] [duration]`,
plus an overflow chip. The 10pm slot gets `--surface-quiet` fill and a caution
line, because a 3h 30m block after the gym is not really 3h 30m of capacity.

### Capacity band — Today, above everything

Eyebrow, then the sentence in display serif, then a supporting line, then a
full-width 14px three-segment bar, then a legend. Primary `Triage Xh YYm`,
secondary `Push to tomorrow`.

The three segments are proportions of *total work due*, not of the day:
fits-before-cutoff / fits-only-late / does-not-fit.

**The empty state must never be "nothing fits."** When nothing fits, that is
the finding, and the band states it. Delete the "Do this now" card.

### Week strip column — Upcoming

Fourteen equal columns, **starting at today and running forward**. Each:

```
weekday letter (mono 9.5) / date (mono 14) / 64px bar area / deficit label (mono 9.5)
```

The bar area holds two bottom-aligned bars, 11px wide, 4px apart: free
calendar in `#D9E3D9`, work due in `--ok` when it fits and `--danger` when it
does not. One shared scale across all fourteen columns (12h = 64px) so heights
compare. A day with nothing due renders a 2px stub in `--track`, not nothing.
Today's column gets `#FBF7F0` fill and a `#E0D3C4` border.

The current strip runs Mon–Sun with today at the far right, so an "Upcoming"
view shows mostly the past. Start at today.

### Habit row — 62px

```
[log button 34 circle] [name + cadence, 168] [28 dots 9×16, grows] [week 64, mono] [streak 56, mono]
```

### Project table row — 54px

```
[chevron 12] [dot 11] [name, grows] [active 70] [progress 96] [left 70] [share 130] [next due 92] [status chip 158]
```

Expands in place to show that project's task rows plus an "Open →" link.

### Finding card — Insights

Coloured dot, category eyebrow, a display-serif headline **containing the
number**, two sentences of evidence, a link to the screen that fixes it. If a
finding cannot name a number, it is not a finding.

### Thin-data panel

Label, a 5px progress bar toward the sample threshold, `4 / 12` in mono, and
one line saying what arriving unlocks. This is the correct home for anything
currently phrased as `Need 2 more samples for bias estimate`.

### Sidebar

Nav items 34px. The projects list carries a right-aligned mono column of time
remaining, sorted descending, so it becomes a workload glance rather than a
set of links. Overdue time shows in `--danger`.

Energy moves **out** of the sidebar footer and onto Today's header as a
labelled 5-step control. It is a daily input that filters the task list; it
cannot live below the fold as five unlabelled bolts.

---

## The two task views

An earlier draft of this spec proposed collapsing List and Upcoming into one
view. That was wrong. They answer different questions and both deserve to
exist. What was actually broken was that Upcoming duplicated the calendar
three times and its week strip carried no information.

**The division of labour**

| | Upcoming | List |
|---|---|---|
| Question | *When does this happen?* | *What do I owe?* |
| Shape | Time. Fourteen days forward. | Inventory. Flat and filterable. |
| Includes | Dated work only | Everything, dated or not, plus Someday |
| Primary act | Move a task to a different day | Filter, group, bulk-edit, triage |
| Calendar | Yes, this is the only place it lives | No |

Rule of thumb: if the question starts with *when*, it belongs in Upcoming. If
it starts with *what*, it belongs in List. Today is the single-day case of
Upcoming, kept separate because it is the screen you open first.

The toggle sits in the page header beside **Add task**, so both views share
one page title and one add action.

### Upcoming

1. Week strip at the top (component above). On the reference data it makes a
   finding visible immediately: everything due sits in the next three days and
   the other eleven are empty. That is a due-date problem, and the strip is
   where you notice it.
2. Day sections below. Today and tomorrow expand by default; later days
   collapse to a 52px summary row with a capacity meter and an event list, and
   expand on click.
3. Each day header carries: date, capacity meter, verdict sentence, a conflict
   chip when there is one, and a contextual action (`Move 2h here from today`
   on a day with slack, `Push work here` on an empty one).
4. Free slots appear inline between events, as day rows.
5. An over-capacity day gets a footer row: `7 tasks still unplaced · 5h 35m
   with nowhere to go` plus a Triage link.
6. **Delete the right-hand calendar rail.** Between the week strip, the inline
   events and the rail, the calendar currently appears three times on one
   screen.
7. Dragging a task between day sections or onto a strip column changes its due
   date. This is the main reason the view exists.

### List

1. One control row, five controls, one height, one style: search, `Group:
   Date | Project | Energy`, energy filter, project filter, Someday toggle.
   The current build has eight controls in four styles, and `Relevant / By
   project / Someday` mixes a sort, a grouping and a filter into one group.
2. Row height 90px → 44px.
3. Capacity in every date group header.
4. Tasks that have a slot on a timeline show `scheduled 4:00pm`, so the views
   agree with each other.

---

## Projects

Replace the two-column card grid with **one table**. Cards forced a 1-task
project and a 6-task project to the same size, which left ragged holes down
the page and made nothing comparable. A table makes every project readable
against every other on the same axes, which is the only reason to have an
overview at all.

Columns: project, active, progress, time left, share of time, next due,
status. Sort by any of them; default is time left descending.

**Inbox is a row.** Tasks with no project currently hold 8h 45m, nearly a
third of all remaining work, and appear nowhere on this page. Render them as a
pseudo-project with a neutral dot and a `Needs assigning` chip.

**Rows expand in place** to show that project's tasks, using the standard task
row. This is what the card grid was trying to do; inline expansion does it
without the layout cost.

**Status chips.** One per row, first match wins, in this order:

| Condition | Chip | Tone |
|---|---|---|
| 0 completions and earliest due is in the past | Overdue, never started | red |
| 0 completions | Never started | orange |
| The Inbox pseudo-project | Needs assigning | neutral |
| Share of remaining time > 30% | `N% of all time left` | orange |
| No completion in 14 days, ≥1 active | Stalled *N* days | orange |
| otherwise | On track | green |

Also fix:

- Raw urgency numbers (90, 87, 60) appeared here with no legend. Use the same
  34×4 banded meter as task rows.
- `Need 2 more samples for bias estimate` is internal plumbing and does not
  belong on a project card. It moves to the project's own page.
- `organizing`, `washer` and `dryer` are steps of *Wash Sheets* sitting at the
  same level as *Clinic SOW*. Either subtasks get a hierarchy and stop
  appearing in project lists, or they stop being tasks.
- Archived and completed collapse into one row at the bottom.

---

## Inside a project

The current detail page spends a quarter of the viewport on four billboard
numbers that say "2 tasks", then leaves 60% of the page empty.

1. **One stat line, not four billboards.** `2 active · 1 done · 1h 15m left`,
   a progress bar, the percentage, and a sentence of context. One 74px card
   replaces the whole header block.
2. Left column: `Active | Done | All` tabs, task rows, an add row, then an
   **On the calendar** block listing events associated with this project.
   Clinic has two this week and the current page shows neither.
3. Right column, three panels:
   - **About** — a description field. Empty state is a dashed box reading
     *No description yet · Say what this project is for*. This field does not
     exist today and is the main reason the page feels hollow.
   - **Estimate accuracy** — the thin-data panel, scoped to this project. This
     is where `Need 2 more samples` belongs, phrased as a promise.
   - **Repeating** — recurring tasks in this project and when the next one
     lands.
4. The page is short, and that is correct. A three-task project does not need
   a dashboard. The old page was not too short, it was too loud and too empty
   at the same time.

---

## Habits

1. Cards → list rows. Five habits in the space one card used.
2. 16-week heatmap → 28-day dot strip. 448 squares to represent twelve piano
   sessions is a lot of ink for no signal.
3. Streak / Best / Total tiles → one streak column. They are the same number
   on four of five habits.
4. Add a **This week** panel: 5 habits × 7 days of clickable squares. This is
   the useful part of the heatmap at the resolution people act on.
5. `Gym 3/2 this week ✓` reads oddly as a fraction over 1. Keep the numerator,
   colour it `--ok`, treat the target as met.
6. Log target is the 34px button at the head of the row, not a 24px `+` in a
   card corner.

---

## Insights (was Analytics)

1. Lead with three finding cards. The three the current data supports:
   - **Capacity** — today holds 10h 50m of work and 5h 15m of time.
   - **Urgency** — 20 of 26 tasks score above 60, so the score has stopped
     sorting anything.
   - **Concentration** — Research is 35% of all remaining time, 6 active, 33%
     done, none scheduled.
2. Replace seven separate project bars with one stacked bar of the full
   27h 55m plus a table, which surfaces the unassigned 8h 45m.
3. Delete the estimate-accuracy donut (50% from four samples is not a
   statistic), the urgency histogram (its one finding is now a card), and the
   7-day energy chart (five bars between 2.0 and 3.0 is not a pattern).
4. Add the **Not enough data yet** panel using the thin-data component.

---

## Derived data the UI needs

Some of this the app already computes; the rest is new. Nothing in the
redesign works without it.

**`freeSlots(date) → [{ start, end, minutes }]`**
Gaps between calendar events inside the working-day bounds. Already exists in
some form ("30m free until 4:30pm"), now needs to be a first-class list.

**`capacity(date) → { freeTotal, freeBeforeCutoff, freeAfterCutoff, dueTotal, deficit }`**
`cutoff` defaults to 22:00 and belongs in settings. `dueTotal` sums estimates
of tasks due that date **minus** tasks already covered by a calendar event.
Read by the capacity band, every group header, every day header, and every
week-strip column.

**`weekCapacity(from, days) → [capacity]`**
Fourteen calls to the above, plus the shared vertical scale for the strip
(max of `max(due, free)` across the range, or a fixed 12h ceiling, whichever
is larger).

**`conflicts(date) → [[eventA, eventB], …]`**
Overlapping calendar events. Monday has two Piano Lessons at 13:00 and 13:30
that overlap by 30 minutes, and nothing currently flags it. Both rows tint,
the earlier one carries the chip, the day header carries a count.

**`fits(slot, tasks) → tasks[]`**
Which unplaced tasks fit a gap. Greedy largest-first is fine; it does not need
to be optimal, it needs to be obviously sensible.

**Task ↔ event linking**
The task *Prep for Big E&M Grutoring* (1h) and the event *Big E&M Grutoring
Prep* (12–1pm) are the same hour counted twice. Match on explicit link first,
fuzzy title second, let the user confirm. Linked tasks leave `dueTotal` and
render under their event.

**Habit ↔ event linking**
Same for Gym and Piano, which appear as both habits and calendar events.

**`projectEvents(project) → events[]`**
Calendar events associated with a project, for the detail page's *On the
calendar* block. Needs an explicit association; do not guess from titles here.

**`projectStatus(project) → chip`**
The rules table under *Projects*.

**Inbox as a pseudo-project**
Tasks with no project need to appear in the projects table, the sidebar
workload list, and the Insights stacked bar. Give them a stable identity
rather than special-casing each surface.

**`urgencyBand(score) → colour`**
`0–40 --ok`, `40–60 --caution`, `60–80 --warn`, `80–100 --danger`. Meter fill
width is the raw score.

**Thin-data thresholds**
Reflections for accuracy: 12. Samples for per-project bias: 3 per project.
Energy logs for correlation: 21 days. Below threshold, a metric renders in a
thin-data panel and nowhere else. No chart is drawn from fewer samples than
its threshold.

**New fields**
Project description. Project↔event association. Subtask parentage (or the
removal of subtasks as tasks).

---

## Suggested order of work

1. `tokens.css` and the type scale. Everything depends on it.
2. Task row and group header components. They appear on four screens.
3. `capacity()` and `freeSlots()`.
4. Today: capacity band, timeline, unplaced rail.
5. Tasks·List: one control row, new rows, capacity headers, delete the
   calendar rail.
6. Tasks·Upcoming: week strip, then day sections, then drag-to-reschedule.
7. Projects: the table, with Inbox as a row.
8. Project detail: the stat line, then the description field, then the right
   column.
9. Habits, then Insights.

Steps 1–4 are most of the value. If work stops after step 4, the app is
already telling the truth about time.

---

## Not covered

- Anything narrower than 1440px. Today's two-column layout and the 14-column
  week strip both need real decisions at tablet and phone width; the timeline
  should probably win and the unplaced rail become a sheet.
- Dark mode. The warm ground is doing work that a naive inversion destroys.
- The Review screen, settings, onboarding, and empty states other than the
  capacity one and the project description.
- Motion. Nothing here depends on animation, but drag-to-place on the
  timeline and drag-between-days on Upcoming both will.
- Keyboard order and focus styling. The reference markup uses real `button`,
  `a`, `input` and `label` elements and the colours were picked for 4.5:1 on
  the paper ground, but focus states are unspecified.
