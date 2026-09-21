/**
 * "Not enough data yet", said as a promise rather than as plumbing.
 *
 * `Need 2 more samples for bias estimate` was on a project card: internal
 * wording, in the wrong place, phrased as a complaint. The same fact stated as
 * what is coming — and how close it is — is worth showing; stated as a missing
 * requirement it is noise.
 *
 * **The right-hand value always carries a noun.** Two denominators in one
 * component is a bug: `1 / 3` on a project page and `1 / 7` on Insights are
 * different units and neither says which. So it is always `1 of 3 samples`,
 * `1 of 7 projects`, and never a bare ratio.
 */

export interface ThinData {
  /** `3 samples`, `7 projects` — plural handled by the caller's unit strings. */
  unit:   string
  have:   number
  need:   number
  /** 0–1, capped: a bar past full would say the threshold moved. */
  ratio:  number
  ready:  boolean
  /** What arriving unlocks. One sentence, present tense, no hedging. */
  unlocks: string
}

export function thinData(opts: {
  have: number
  need: number
  /** Singular and plural of the thing being counted. */
  unit: [string, string]
  /** Called with how many are still missing; only used when not ready. */
  unlocks: (missing: number) => string
  /** Said instead once the threshold is met. */
  readyText: string
}): ThinData {
  const { have, need, unit, unlocks, readyText } = opts
  const missing = Math.max(0, need - have)
  const ready = missing === 0

  return {
    unit: `${need} ${need === 1 ? unit[0] : unit[1]}`,
    have,
    need,
    ratio: need > 0 ? Math.min(1, have / need) : 1,
    ready,
    unlocks: ready ? readyText : unlocks(missing),
  }
}

/* Spelled out, because this is prose: "Two more finished Clinic tasks" reads
   as a sentence and "2 more" reads as a counter. Only small numbers occur —
   the gap can never exceed the threshold. */
const WORDS = ['no', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']
const spell = (n: number) => WORDS[n] ?? String(n)

/** Finished tasks with a logged actual before the bias correction is trusted. */
export const ESTIMATE_SAMPLES_NEEDED = 3

/**
 * The estimate-accuracy panel for one project.
 *
 * `bias_ratio` is only quoted once the threshold is met. A ratio from one
 * sample is not an estimate of anything, and printing "33% under" from a
 * single task is how a number nobody should act on ends up on a page.
 */
export function estimateAccuracy(opts: {
  projectName: string
  sampleCount: number
  biasRatio:   number | null
}): ThinData {
  const { projectName, sampleCount, biasRatio } = opts

  return thinData({
    have: sampleCount,
    need: ESTIMATE_SAMPLES_NEEDED,
    unit: ['sample', 'samples'],
    unlocks: missing =>
      `${spell(missing)} more finished ${projectName} `
      + `task${missing === 1 ? '' : 's'} with a reflection and Planner can start `
      + `correcting these estimates for you.`,
    readyText: biasRatio === null || Math.abs(biasRatio - 1) < 0.05
      ? `Your ${projectName} estimates are about right.`
      : biasRatio > 1
        ? `${projectName} tasks run about ${Math.round((biasRatio - 1) * 100)}% longer than you estimate. Planner is correcting for it.`
        : `${projectName} tasks finish about ${Math.round((1 - biasRatio) * 100)}% faster than you estimate. Planner is correcting for it.`,
  })
}
