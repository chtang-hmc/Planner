import { describe, it, expect } from 'vitest'
import {
  PARSE_FIELDS, PARSE_SCHEMA, buildParsePrompt, normalizeParse, fillBlanks, type ParsedTask,
} from './parse-task'
import { parseQuickAdd } from './quick-add'

/**
 * The ✦ Parse contract. #17 happened because the prompt could fall behind the
 * grammar without any test failing; these pin both halves and the merge.
 *
 * Reference: Wednesday 16 September 2026, noon in Los Angeles — the same
 * instant quick-add.test.ts uses.
 */
const NOW = new Date('2026-09-16T19:00:00Z')
const LA = 'America/Los_Angeles'
const TODAY = '2026-09-16'
const PROJECTS = [
  { id: 'p-thesis', name: 'Thesis' },
  { id: 'p-ta', name: 'TA' },
  { id: 'p-pp', name: 'Public Policy' },
]

const grammar = (text: string) => parseQuickAdd(text, { tz: LA, now: NOW, projects: PROJECTS })
const norm = (raw: Record<string, unknown>) => normalizeParse(raw, { today: TODAY, projects: PROJECTS })

/** An answer that states nothing, so each test sets only what it is about. */
const blank = {
  title: 'x', due_date: null, due_time: null, estimated_minutes: null, energy_required: 'medium',
  priority: null, rrule: null, rrule_from_completion: false, project_hint: null, is_calendar_event: false,
}

describe('what Claude is asked for', () => {
  it('requires every field the validator reads, and nothing else', () => {
    expect([...PARSE_SCHEMA.required]).toEqual(PARSE_FIELDS)
    expect(Object.keys(PARSE_SCHEMA.properties)).toEqual(PARSE_FIELDS)
    expect(PARSE_SCHEMA.additionalProperties).toBe(false)
  })

  it('names every field in the prompt', () => {
    const prompt = buildParsePrompt('Email Rosner', TODAY, PROJECTS)
    for (const f of PARSE_FIELDS) expect(prompt).toContain(`- ${f}:`)
  })

  /**
   * The capabilities the grammar gained after the prompt was written — the
   * whole of #17. If one is dropped from the table, this fails.
   */
  it('asks for priority, repeat, repeat-from-completion and a time of day', () => {
    for (const f of ['priority', 'rrule', 'rrule_from_completion', 'due_time'])
      expect(PARSE_FIELDS).toContain(f)
  })

  it('gives today and the project names, and quotes the text', () => {
    const prompt = buildParsePrompt('Say "hi" to Rosner', TODAY, PROJECTS)
    expect(prompt).toContain('Today is 2026-09-16.')
    expect(prompt).toContain('Thesis, TA, Public Policy')
    expect(prompt).toContain('"Say \\"hi\\" to Rosner"')
  })
})

describe('checking the answer', () => {
  it('maps priority words onto the stored scale, where 4 is Critical', () => {
    expect(norm({ ...blank, priority: 'critical' }).priority).toBe(4)
    expect(norm({ ...blank, priority: 'high' }).priority).toBe(3)
    expect(norm({ ...blank, priority: 'medium' }).priority).toBe(2)
    expect(norm({ ...blank, priority: 'low' }).priority).toBe(1)
    expect(norm({ ...blank, priority: 'p1' }).priority).toBeNull()
  })

  it('keeps a rule that fires, in the bare form tasks.rrule stores', () => {
    expect(norm({ ...blank, rrule: 'FREQ=WEEKLY;BYDAY=MO' }).rrule).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(norm({ ...blank, rrule: 'RRULE:freq=daily;interval=3' }).rrule).toBe('FREQ=DAILY;INTERVAL=3')
  })

  it('drops a rule that is malformed or can never produce a date', () => {
    expect(norm({ ...blank, rrule: 'every monday' }).rrule).toBeNull()
    expect(norm({ ...blank, rrule: 'FREQ=HOURLY' }).rrule).toBeNull()
    expect(norm({ ...blank, rrule: 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30' }).rrule).toBeNull()
  })

  it('counts from completion only when there is a repeat to count', () => {
    expect(norm({ ...blank, rrule: 'FREQ=DAILY;INTERVAL=3', rrule_from_completion: true }).rruleFromCompletion).toBe(true)
    expect(norm({ ...blank, rrule: null, rrule_from_completion: true }).rruleFromCompletion).toBe(false)
  })

  it('reads a 24-hour time into minutes past midnight', () => {
    expect(norm({ ...blank, due_time: '17:00' }).timeMinutes).toBe(1020)
    expect(norm({ ...blank, due_time: '9:05' }).timeMinutes).toBe(545)
    expect(norm({ ...blank, due_time: '5pm' }).timeMinutes).toBeNull()
    expect(norm({ ...blank, due_time: '24:00' }).timeMinutes).toBeNull()
  })

  it('takes a real calendar day and refuses one that rolls over', () => {
    expect(norm({ ...blank, due_date: '2026-09-18' }).dueDay).toBe('2026-09-18')
    expect(norm({ ...blank, due_date: '2026-02-30' }).dueDay).toBeNull()
    expect(norm({ ...blank, due_date: 'friday' }).dueDay).toBeNull()
  })

  it('keeps a sane estimate and energy', () => {
    expect(norm({ ...blank, estimated_minutes: 45 }).estimateMinutes).toBe(45)
    expect(norm({ ...blank, estimated_minutes: 0 }).estimateMinutes).toBeNull()
    expect(norm({ ...blank, estimated_minutes: 2.5 }).estimateMinutes).toBeNull()
    expect(norm({ ...blank, energy_required: 'high' }).energy).toBe('high')
    expect(norm({ ...blank, energy_required: 'extreme' }).energy).toBe('medium')
  })

  it('matches a project hint to a project that exists, and never invents one', () => {
    expect(norm({ ...blank, project_hint: 'thesis' }).projectId).toBe('p-thesis')
    expect(norm({ ...blank, project_hint: 'public policy class' }).projectId).toBe('p-pp')
    expect(norm({ ...blank, project_hint: 'Groceries' }).projectId).toBeNull()
  })

  it('survives an answer that is not an object at all', () => {
    const r = normalizeParse(null, { today: TODAY, projects: PROJECTS })
    expect(r.title).toBe('')
    expect(r.energy).toBe('medium')
    expect(r.rrule).toBeNull()
  })
})

describe('merging with the grammar', () => {
  const ai = (over: Partial<ParsedTask>): ParsedTask => ({
    title: 'x', dueDay: null, timeMinutes: null, estimateMinutes: null, energy: 'medium', priority: null,
    rrule: null, rruleFromCompletion: false, projectId: null, isCalendarEvent: false, ...over,
  })

  /**
   * The bug in #17, exactly: the field lit up a repeat, a time and a priority,
   * the button came back without them, and they were overwritten.
   */
  it('never touches what the grammar found', () => {
    const g = grammar('call mom every monday at 5pm p1')
    const fill = fillBlanks(g, ai({
      dueDay: '2026-09-30', timeMinutes: 9 * 60, rrule: 'FREQ=DAILY', priority: 1, energy: 'low',
    }))
    expect(fill).toEqual({ energy: 'low' })
  })

  it('fills each field the grammar left empty', () => {
    const g = grammar('Draft the methods section')
    const fill = fillBlanks(g, ai({
      dueDay: '2026-09-18', timeMinutes: 600, rrule: 'FREQ=WEEKLY;BYDAY=FR', rruleFromCompletion: true,
      projectId: 'p-thesis', priority: 3, estimateMinutes: 90, energy: 'high',
    }))
    expect(fill).toEqual({
      dueDay: '2026-09-18', timeMinutes: 600, rrule: 'FREQ=WEEKLY;BYDAY=FR', rruleFromCompletion: true,
      projectId: 'p-thesis', priority: 3, estimateMinutes: 90, energy: 'high',
    })
  })

  it('treats a repeat’s first day as a date the grammar found', () => {
    const g = grammar('Water plants every monday')
    expect(fillBlanks(g, ai({ dueDay: '2026-09-17' })).dueDay).toBeUndefined()
  })

  it('mixes the two, field by field', () => {
    const g = grammar('Grade labs friday #ta')
    const fill = fillBlanks(g, ai({ dueDay: '2026-09-20', projectId: 'p-thesis', estimateMinutes: 60, priority: 3 }))
    expect(fill.dueDay).toBeUndefined()
    expect(fill.projectId).toBeUndefined()
    expect(fill.estimateMinutes).toBe(60)
    expect(fill.priority).toBe(3)
  })

  /**
   * Seen in a live call on 2026-09-27: the grammar read "every 3 days" and
   * Claude read "after I last did it". The repeat is the grammar's; counting
   * from completion is something only Claude saw.
   */
  it('lets Claude add counting-from-completion to a repeat the grammar found', () => {
    const g = grammar('water the plants every 3 days after I last did it')
    const fill = fillBlanks(g, ai({ rrule: 'FREQ=DAILY;INTERVAL=3', rruleFromCompletion: true }))
    expect(fill.rrule).toBeUndefined()
    expect(fill.rruleFromCompletion).toBe(true)
    // …but not when Claude saw no repeat at all.
    expect(fillBlanks(g, ai({ rruleFromCompletion: true })).rruleFromCompletion).toBeUndefined()
  })

  it('never takes the title from Claude', () => {
    expect('title' in fillBlanks(grammar('email rosner re: chapter 3'), ai({ title: 'Email Rosner about chapter 3' }))).toBe(false)
  })
})
