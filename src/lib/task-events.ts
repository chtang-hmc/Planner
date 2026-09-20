/**
 * Is this calendar event already doing this task?
 *
 * The app cannot know, so it guesses from the title and asks. This module is
 * the guess; migration 0019 stores the answer.
 *
 * It matters because a task and the event booked for it are the same hour
 * counted twice, and every capacity number is wrong by that much. The real
 * pair on this calendar is the task *Prep for Big E&M Grutoring* (1h) against
 * the event *Big E&M Grutoring Prep* (12–1pm).
 *
 * **A guess never changes a number.** Until a link is confirmed, the task
 * counts toward `dueTotal` in full. Silently deducting an hour on a title
 * resemblance would make the headline figure depend on a heuristic nobody
 * agreed to, and be invisible when it was wrong.
 */

/** Connectives only. Domain words carry meaning and stay — see `titleTokens`. */
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'onto', 'this', 'that'])

/**
 * Title words worth comparing.
 *
 * Three characters minimum, which drops `e&m` — unfortunate for the very pair
 * this exists for, and still right: two-letter tokens match far too much.
 * Enough signal survives in the rest.
 *
 * Domain words like `prep` are kept. An earlier version dropped them to stop
 * *Prep for X* pairing with *Prep for Y*, and on real data that was worse: it
 * made *Prep for Big E&M Grutoring* score 1.0 against **both** the 1h prep
 * event and the 3h lecture, because `big` and `grutoring` were all that was
 * left of either. The overlap metric solves that properly — see below — and
 * *Prep for X* against *Prep for Y* scores 0.33 and is refused.
 */
export function titleTokens(title: string): string[] {
  return [...new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOPWORDS.has(w)),
  )]
}

export interface LinkCandidate {
  taskId:     string
  eventId:    string
  /**
   * 0–1, as shared words over *all* words in either title.
   *
   * Over the union rather than the smaller vocabulary, which is what makes it
   * discriminate. Against the smaller one, a title that is a strict subset of
   * another always scores 1.0 — so *Prep for Big E&M Grutoring* tied at 1.0
   * with both the prep event and the three-hour lecture, and the suggestion
   * shown was a coin flip between right and wrong.
   */
  confidence: number
  /** The words that matched, for the chip to explain itself if it ever needs to. */
  shared:     string[]
}

export interface LinkableTask {
  id:       string
  title:    string
  /** Local day the task is due, or null. */
  dueDay:   string | null
  minutes:  number | null
}

export interface LinkableEvent {
  id:      string
  title:   string
  /** Local day the event falls on. */
  day:     string
  minutes: number
}

export interface DecidedLink {
  taskId:   string
  eventId:  string
  status:   'confirmed' | 'rejected'
}

export const linkKey = (taskId: string, eventId: string) => `${taskId}:${eventId}`

/** Below this, a shared word is more likely coincidence than a match. */
export const MIN_CONFIDENCE = 0.5

/**
 * Candidate pairs, best first.
 *
 * Two constraints beyond the words:
 *
 * - **Same day.** A task due Tuesday is not covered by an event last Thursday,
 *   however alike the titles are. Undated tasks match nothing, because there
 *   is no day to agree on.
 * - **Already decided pairs never reappear.** A rejection that does not stick
 *   means the same wrong suggestion every morning, which is how a prompt
 *   becomes something people learn to dismiss without reading.
 */
export function suggestTaskEventLinks(
  tasks:   LinkableTask[],
  events:  LinkableEvent[],
  links:   readonly DecidedLink[] = [],
): LinkCandidate[] {
  const eventById   = new Map(events.map(e => [e.id, e]))
  const eventTokens = events.map(e => ({ event: e, tokens: titleTokens(e.title) }))

  const decided = new Set(links.map(l => linkKey(l.taskId, l.eventId)))

  // How much of each task a confirmed event already accounts for. A task whose
  // estimate is met stops being asked about: the join table exists so one task
  // can span two sittings, but once the sittings add up there is nothing left
  // for a third event to cover, and asking anyway is how confirming the right
  // link earns you a question about the wrong one.
  const coveredMinutes = new Map<string, number>()
  for (const l of links) {
    if (l.status !== 'confirmed') continue
    const ev = eventById.get(l.eventId)
    if (ev) coveredMinutes.set(l.taskId, (coveredMinutes.get(l.taskId) ?? 0) + ev.minutes)
  }

  const out: LinkCandidate[] = []

  for (const task of tasks) {
    if (!task.dueDay) continue
    if (task.minutes != null && (coveredMinutes.get(task.id) ?? 0) >= task.minutes) continue

    const tTokens = titleTokens(task.title)
    if (tTokens.length === 0) continue

    for (const { event, tokens } of eventTokens) {
      if (event.day !== task.dueDay) continue
      if (decided.has(linkKey(task.id, event.id))) continue
      if (tokens.length === 0) continue

      const shared = tTokens.filter(w => tokens.includes(w))
      if (shared.length === 0) continue

      const union = new Set([...tTokens, ...tokens]).size
      const confidence = shared.length / union
      if (confidence < MIN_CONFIDENCE) continue

      out.push({ taskId: task.id, eventId: event.id, confidence, shared })
    }
  }

  // Best first. Duration proximity breaks a tie, because an event the same
  // length as the task is far more likely to be the task than one three times
  // its size — and on this calendar that is exactly the pair that ties.
  const sizeGap = (c: LinkCandidate) => {
    const t = tasks.find(x => x.id === c.taskId)
    const e = eventById.get(c.eventId)
    return t?.minutes == null || !e ? Number.MAX_SAFE_INTEGER : Math.abs(t.minutes - e.minutes)
  }

  return out.sort((a, b) =>
    b.confidence - a.confidence ||
    sizeGap(a) - sizeGap(b) ||
    a.taskId.localeCompare(b.taskId),
  )
}

/**
 * The one suggestion to show, if any.
 *
 * One at a time, on the highest-confidence pair. A timeline that asks four
 * questions at once is a queue, and a queue gets closed rather than answered.
 */
export function topSuggestion(candidates: LinkCandidate[]): LinkCandidate | null {
  return candidates[0] ?? null
}
