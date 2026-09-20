import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Every custom property a component names must be defined.
 *
 * Twice now a component has referenced a token that existed only in the
 * designer's `tokens.css` and had never been ported into `globals.css`:
 * `--accent-tint` rendered the link-suggestion strip with no background, and
 * `--gap-target` left two opposite-meaning buttons flush against each other.
 * Both looked fine in review and were only caught by reading computed styles
 * in a browser — CSS fails silently, so nothing else will catch this.
 */
const css = readFileSync('src/app/globals.css', 'utf8')
const SOURCES = [
  'src/components/ds/CapacityBand.tsx',
  'src/components/ds/CapacityMeter.tsx',
  'src/components/ds/Timeline.tsx',
  'src/components/ds/UnplacedRail.tsx',
  'src/components/ds/TaskRow.tsx',
]

/** Tokens Tailwind generates from @theme, so they never appear as --name:. */
const FROM_THEME = /^(text|color|font|spacing)-/

describe('the design tokens components use are defined', () => {
  const defined = new Set(
    [...css.matchAll(/^\s*--([a-z0-9-]+)\s*:/gm)].map(m => m[1]),
  )

  for (const file of SOURCES) {
    it(`${file.split('/').pop()} names no undefined custom property`, () => {
      const src = readFileSync(file, 'utf8')
      const used = [...src.matchAll(/var\(--([a-z0-9-]+)/g)].map(m => m[1])
      const missing = [...new Set(used)].filter(n => !defined.has(n) && !FROM_THEME.test(n))
      expect(missing).toEqual([])
    })
  }

  it('knows what it is checking', () => {
    // A guard against the regex silently matching nothing and passing.
    expect(defined.has('accent-tint')).toBe(true)
    expect(defined.has('gap-target')).toBe(true)
    expect(defined.has('tap-min')).toBe(true)
  })
})
