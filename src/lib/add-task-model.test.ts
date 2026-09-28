import { describe, it, expect } from 'vitest'
import { parseQuickAdd } from './quick-add'
import {
  resolve, receipt, setValue, excludeSpans, guessFrom, toCreate, habitPlan,
  daysOf, repeatFromDays, withoutToken, type Mode, type Values,
} from './add-task-model'

/**
 * The modal's one-owner-per-attribute model. Reference: Wednesday 16 September
 * 2026, noon in Los Angeles, as in quick-add.test.ts.
 */
const NOW = new Date('2026-09-16T19:00:00Z')
const LA = 'America/Los_Angeles'
const TODAY = '2026-09-16'
const PROJECTS = [{ id: 'thesis', name: 'Thesis' }, { id: 'ta', name: 'TA' }]
const ctx = { today: TODAY, projects: PROJECTS }

function model(text: string, opts: { mode?: Mode; set?: Partial<Values>; guess?: Partial<Values>; kept?: string[] } = {}) {
  const mode = opts.mode ?? 'task'
  const parse = parseQuickAdd(text, {
    tz: LA, now: NOW, projects: PROJECTS, mode, exclude: excludeSpans(text, opts.kept ?? []),
  })
  const r = resolve(parse, opts.set ?? {}, opts.guess ?? {})
  return { parse, r, chips: receipt(parse, r, mode, ctx, opts.kept ?? []) }
}

describe('who owns each value', () => {
  it('gives typed text precedence over a setting, and a setting over a guess', () => {
    const { r } = model('Email Rosner p1', { set: { priority: 3, energy: 'low' }, guess: { energy: 'high', estimate: 30 } })
    expect(r.priority).toMatchObject({ value: 4, owner: 'typed' })
    expect(r.energy).toMatchObject({ value: 'low', owner: 'set' })
    expect(r.estimate).toMatchObject({ value: 30, owner: 'guessed' })
    expect(r.where).toMatchObject({ value: 'anywhere', owner: 'default' })
  })

  it('marks a day the text implied, and lets a setting override it', () => {
    expect(model('Call mom at 5pm').r.due).toMatchObject({ value: TODAY, owner: 'implied' })
    expect(model('Water plants every friday').r.due).toMatchObject({ value: '2026-09-18', owner: 'implied' })
    // Upcoming opened the modal on Friday's column; "at 5pm" then means Friday.
    expect(model('Call mom at 5pm', { set: { due: '2026-09-18' } }).r.due).toMatchObject({ value: '2026-09-18', owner: 'set' })
  })

  it('lets a typed value win over a setting made first, and hands back when it goes', () => {
    const set = { priority: 3 as const }
    expect(model('x p1', { set }).r.priority.value).toBe(4)
    expect(model('x', { set }).r.priority.value).toBe(3)
  })
})

describe('the receipt', () => {
  it('lists what was typed, in the order it was typed, in words', () => {
    const { chips } = model('Email Rosner tomorrow at 5pm #thesis p1 for 45m')
    expect(chips.map(c => [c.kind, c.group, c.label])).toEqual([
      ['typed', 'when', 'Tomorrow'],
      ['typed', 'when', '5 PM'],
      ['typed', 'project', 'Thesis'],
      ['typed', 'priority', 'Critical'],
      ['typed', 'estimate', '45m'],
    ])
  })

  it('says which day an implied value lands on', () => {
    expect(model('Call mom at 5pm').chips[0].label).toBe('5 PM today')
    expect(model('Call mom at 9am').chips[0].label).toBe('9 AM tomorrow')
    expect(model('Water plants every! 3 days').chips[0].label).toBe('Every 3 days, from when done · starts today')
  })

  it('lists settings that are in effect but out of sight, and not the ones left at default', () => {
    const { chips } = model('Laundry for 20m', { set: { where: 'home', span: 90, buffer: 0, priority: 2 } })
    expect(chips.filter(c => c.kind === 'set').map(c => c.label)).toEqual(['At home', 'Ties me up 1h 30m', 'No buffer'])
  })

  it('marks guesses, and only where nothing else set the value', () => {
    const { chips } = model('Draft chapter 3 for 90m', { guess: { energy: 'high', estimate: 45 } })
    expect(chips.filter(c => c.kind === 'guessed').map(c => c.label)).toEqual(['High energy'])
  })

  it('shows a kept fragment so it can be read again', () => {
    const { chips, parse } = model('Call mom monday about friday plans', { kept: ['monday'] })
    expect(parse.dueDay).toBe('2026-09-18')
    expect(chips.at(-1)).toMatchObject({ kind: 'kept', fragment: 'monday' })
  })

  it('lists only kept fragments when the rows are showing', () => {
    const { parse, r } = model('x tomorrow p1', { set: { where: 'home' } })
    expect(receipt(parse, r, 'task', ctx, [], true)).toEqual([])
  })

  it('words a habit in the habits page’s own terms', () => {
    const { chips, r } = model('Gym 3x a week for 60m', { mode: 'habit' })
    expect(chips.map(c => c.label)).toEqual(['3× a week', '1h sessions'])
    expect(habitPlan(r)).toBe('Books 3 × 1h on separate days each week.')
  })
})

describe('handing a typed value to a control', () => {
  it('takes the fragment out of the text and keeps the rest', () => {
    const text = 'Email Rosner tomorrow p1'
    const { r } = model(text)
    const next = setValue({ text, set: {} }, r, 'due', '2026-09-18')
    expect(next.text).toBe('Email Rosner p1')
    expect(next.set.due).toBe('2026-09-18')
    expect(next.removed).toEqual({ fragment: 'tomorrow', before: { text, set: {} } })
  })

  it('pins the day a removed time was implying', () => {
    const text = 'Call mom at 5pm'
    const { r } = model(text)
    const next = setValue({ text, set: {} }, r, 'time', 18 * 60)
    expect(next.text).toBe('Call mom')
    expect(next.set).toEqual({ due: TODAY, time: 18 * 60 })
  })

  it('leaves the text alone when the value was not typed', () => {
    const text = 'Email Rosner'
    const next = setValue({ text, set: {} }, model(text).r, 'priority', 3)
    expect(next.text).toBe(text)
    expect(next.removed).toBeNull()
  })

  it('closes the gap a fragment leaves', () => {
    expect(withoutToken('a b c', { start: 2, end: 3 })).toBe('a c')
    expect(withoutToken('b c', { start: 0, end: 1 })).toBe('c')
    expect(withoutToken('a b', { start: 2, end: 3 })).toBe('a')
  })
})

describe('habit days', () => {
  it('round-trips a set of weekdays through the rule, in the presets’ byte form', () => {
    expect(repeatFromDays(['FR', 'MO', 'WE'])).toEqual({ rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', fromCompletion: false })
    expect(daysOf({ rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', fromCompletion: false })).toEqual(['MO', 'WE', 'FR'])
    expect(repeatFromDays(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'])?.rrule).toBe('FREQ=DAILY')
    expect(repeatFromDays([])).toBeNull()
  })
})

describe('Claude’s guess', () => {
  it('keeps only what this kind of thing has', () => {
    const fill = { energy: 'high' as const, dueDay: '2026-09-18', projectId: 'thesis', estimateMinutes: 45 }
    expect(guessFrom(fill, 'task')).toEqual({ energy: 'high', due: '2026-09-18', project: 'thesis', estimate: 45 })
    expect(guessFrom(fill, 'habit')).toEqual({ energy: 'high', estimate: 45 })
  })
})

describe('what is saved', () => {
  it('sends a bare time with the day it implied', () => {
    const { parse, r } = model('Call mom at 5pm')
    expect(toCreate(parse.title, r, 'task')).toMatchObject({
      title: 'Call mom', due_date: '2026-09-16T00:00:00.000Z', due_time_minutes: 17 * 60,
    })
  })

  it('sends everything typed, in the columns createTask expects', () => {
    const { parse, r } = model('Email Rosner tomorrow at 5pm #thesis p1 for 45m every! 3 days')
    expect(toCreate(parse.title, r, 'task')).toMatchObject({
      title: 'Email Rosner', project_id: 'thesis', priority: 4, estimated_minutes: 45,
      due_date: '2026-09-17T00:00:00.000Z', due_time_minutes: 17 * 60,
      rrule: 'FREQ=DAILY;INTERVAL=3', rrule_from_completion: true, taskType: undefined,
    })
  })

  it('sends a habit without a task’s dates or project', () => {
    const { parse, r } = model('Gym 3x a week for 60m p2', { mode: 'habit', set: { due: TODAY, project: 'thesis', avoidMeals: true } })
    expect(toCreate(parse.title, r, 'habit')).toMatchObject({
      title: 'Gym', taskType: 'habit', weekly_target: 3, estimated_minutes: 60, priority: 3,
      due_date: null, project_id: null, start_date: null, due_time_minutes: null, avoid_after_breaks: true,
    })
  })
})
