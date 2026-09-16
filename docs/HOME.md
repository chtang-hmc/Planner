# Home / Today — spec

Status: **agreed, not built.**

## What it is

The landing page, and the answer to *"what should I do now?"*

It is not a dashboard. Everything on it is either something to act on or the
context needed to choose. A page you read rather than use would not earn the
root URL.

## Why it replaces Plan Day rather than joining it

`DayPlanModal` already shows one day's ranked attack list, its proposed blocks
and the existing calendar around them. That is most of this page behind a date
picker in a toolbar.

Building Home beside it would leave four surfaces showing time — Plan Day,
Home, Upcoming, Schedule week — which is how an app gets confusing. So Plan Day
is promoted to a page rather than duplicated:

- the thing you do every morning stops being a modal
- a modal cannot be a landing page, so today's plan was always something you had
  to go and ask for
- habits and overdue work have nowhere sensible to live in a modal, and belong
  next to today's plan
- `/` gets an obvious destination

**Plan Day's power is kept, not dropped.** Writing blocks to Google Calendar
becomes a button on the page.

## Sections, top to bottom

### 1. Right now

One sentence. In an event: *"In Fall Fest until 1:15. Next free: 1h 30m at
1:15."* In a gap: *"1h 30m free until CSCI 134 at 2:45."*

### 2. Do this now

The recommendation: one primary, two alternates, each carrying **why it was
picked** — "fits your 1h 30m · due today · good energy window". A suggestion
without a reason is an oracle, and an oracle that is wrong once stops being
trusted.

Actionable in place: start the timer, mark done, open the task.

### 3. Today's shape

Events in time order with **free gaps as their own rows**, each gap saying what
fits in it:

```
 1:15 – 2:45   1h 30m free    → 2 readings, or Update Resume
 2:45          CSCI 134
 4:00          Piano
 5:00 – 6:00   1h free        → Print Readings + Wash Sheets
 6:00          Clinic Group Meeting
 7:00 – 8:00   1h free        → Grade Algorithms
 8:00          Algs Grutoring
```

A drawn hour column was considered and rejected: working hours run 10:00–01:30,
so a full axis is 15½ hours — a scroll, not a glance.

**Overlapping events must not be flattened.** A real day has them (Fall Fest
11:00–13:15 runs under ENTR 179A 11:00–12:15) and the free block after them
starts at 13:15, not 12:15. Gap arithmetic works from the running maximum end
time, not the previous event's end. This is the main correctness trap in the
whole page and needs a test.

### 4. Habits

Today's habits, one tap each. Reuses `HabitRow` from `TaskChrome.tsx`.

### 5. Needs attention

Overdue and due today only. Short by design, and empty on a good day.

## Ranking

For a given gap, a task is a **candidate** when:

- it is pending, not `someday`, and not gated by a future `start_date`
- `duration ≤ gap − buffer` (its own `buffer_minutes`, else the global default)
- its `location` is compatible — never suggest an *away* task for a 30-minute
  slot between two classes
- it is not already done or scheduled elsewhere today

Candidates order by:

1. **urgency** — `urgency_score`, already deadline-and-priority aware
2. **energy match** for that time block, from the configured energy schedule
   (not from energy logs — there are two of those, ever)
3. **fit** — prefer a task that uses the gap well over one that leaves 80% idle

Subtasks are offered as a run where a chain fits, the same way the scheduler
groups them: "2 readings" rather than one at a time.

## Data and speed

**No Google round trip on load.** `planDay` currently calls `proposeSchedule`,
which hits freeBusy — that is the wait that made "Schedule my week" unpleasant,
and it must not sit on the landing path.

Everything needed is already local: `calendar_events` is synced, tasks and
habits are ours, working hours and breaks are config. Home renders from those.

The cost is staleness — an event added in Google and not yet synced is invisible.
Mitigate with a quiet "synced 2h ago · refresh" control, not by blocking the page.

**Writing blocks still calls Google**, on demand, from the button. That is a
deliberate action and can take its time.

### One extraction needed

`freeSlots()` and `workWindow()` are internal to `runScheduler`. Computing gaps
without running the scheduler means lifting a small helper out:

```ts
freeGaps(dayStr, tz, workingHours, busy, breaks): Interval[]
```

Pure, and therefore testable — it is where the overlap trap lives.

## What changes elsewhere

- `src/app/page.tsx` renders Home instead of redirecting; the `/` redirect in
  `src/proxy.ts` goes away
- Sidebar gains **Home** at the top
- The tasks toolbar loses its date picker and **Plan** button
- `DayPlanModal` is absorbed; `planDay` stays as the action behind the
  write-to-calendar button

## Out of scope

Stats and charts (Analytics exists, and with 2 energy logs it is thin), streak
trophies, a second task list, energy check-in prompts.

## Risks

**Suggestions are only as good as the priorities behind them.** Six of 21
pending tasks have no due date, so ranking leans on priority — and if most sit
at P2 the page will look confident while guessing. Showing the reason for each
pick is what keeps that honest.

**It will be the slowest thing on the critical path** simply by being first.
Keep the Google call off it.

**Removing Plan Day is a one-way door in muscle-memory terms.** If Home does not
land, putting the modal back is easy; changing the habit twice is not.
