'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import { Project, EnergyLevel } from '@/types'
import { createTask } from '@/app/actions/tasks'

interface ParsedResult {
  title: string
  due_date: string | null
  estimated_minutes: number | null
  energy_required: EnergyLevel
  project_hint: string | null
  project_id: string | null
  is_calendar_event: boolean
}

const ENERGY_ICON: Record<EnergyLevel, string> = { low: '🌿', medium: '⚡', high: '🔥' }
const PRIORITY_LABELS = ['', 'Low', 'Medium', 'High', 'Critical'] as const

interface Props {
  projects: Project[]
  initialProjectId?: string
  onClose: () => void
  onCreated: () => void
}

export default function AddTaskModal({ projects, initialProjectId, onClose, onCreated }: Props) {
  const [text, setText]             = useState('')
  const [parsed, setParsed]         = useState<ParsedResult | null>(null)
  const [parsing, setParsing]       = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)

  // Editable fields (populated from parsed result)
  const [title, setTitle]       = useState('')
  const [projectId, setProject] = useState(initialProjectId ?? '')
  const [priority, setPriority] = useState<1|2|3|4>(2)
  const [energy, setEnergy]     = useState<EnergyLevel>('medium')
  const [estimate, setEstimate] = useState('')
  const [dueDate, setDueDate]   = useState('')

  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  async function handleParse() {
    if (!text.trim()) return
    setParsing(true)
    setParseError(null)
    try {
      const res = await fetch('/api/parse-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, projects: projects.map(p => ({ id: p.id, name: p.name })) }),
      })
      if (!res.ok) throw new Error('Parse failed')
      const data: ParsedResult = await res.json()
      setParsed(data)
      // Pre-fill editable fields
      setTitle(data.title)
      if (data.project_id) setProject(data.project_id)
      setEnergy(data.energy_required ?? 'medium')
      if (data.estimated_minutes) setEstimate(String(data.estimated_minutes))
      if (data.due_date) setDueDate(data.due_date)
    } catch {
      setParseError('Could not parse — please fill fields manually')
      setParsed(null)
      setTitle(text.trim())
    } finally {
      setParsing(false)
    }
  }

  function handleCreate() {
    if (!title.trim()) return
    startTransition(async () => {
      await createTask({
        title: title.trim(),
        project_id: projectId,
        priority,
        energy_required: energy,
        estimated_minutes: estimate ? parseInt(estimate) : null,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        urgency_curve: 'linear',
      })
      onCreated()
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-slate-950/40 dark:bg-slate-950/60" />

      <div
        className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl flex flex-col gap-0 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Quick-add input ── */}
        <div className="p-5 pb-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-600 dark:text-teal-400 mb-2">
            ✦ Quick add
          </p>
          <textarea
            ref={inputRef}
            value={text}
            onChange={e => { setText(e.target.value); setParsed(null) }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleParse() } }}
            rows={2}
            placeholder="e.g. Submit CS homework by Friday, 45 min, high energy"
            className="w-full text-sm text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <div className="flex justify-between items-center mt-2 mb-3">
            <p className="text-xs text-slate-400">
              {parsed ? '✓ Parsed — review below' : 'Press Enter or click Parse →'}
            </p>
            <button
              onClick={handleParse}
              disabled={!text.trim() || parsing}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-teal-500 text-white hover:bg-teal-600 disabled:opacity-40 transition-colors"
            >
              {parsing ? 'Parsing…' : '✦ Parse'}
            </button>
          </div>
          {parseError && <p className="text-xs text-amber-500 mb-3">{parseError}</p>}
        </div>

        <div className="border-t border-slate-100 dark:border-slate-800" />

        {/* ── Editable fields ── */}
        <div className="p-5 flex flex-col gap-4">

          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Task title"
              className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          {/* Project + Priority row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Project</label>
              <select
                value={projectId}
                onChange={e => setProject(e.target.value)}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="">— No project —</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Priority</label>
              <div className="flex gap-1">
                {([1, 2, 3, 4] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setPriority(p)}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${
                      priority === p
                        ? 'bg-slate-900 dark:bg-white border-slate-900 dark:border-white text-white dark:text-slate-900'
                        : 'border-slate-200 dark:border-slate-700 text-slate-400 hover:border-slate-300'
                    }`}
                    title={PRIORITY_LABELS[p]}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Energy */}
          <div>
            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Energy required</label>
            <div className="flex gap-1.5">
              {(['low', 'medium', 'high'] as const).map(e => (
                <button
                  key={e}
                  onClick={() => setEnergy(e)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    energy === e
                      ? 'bg-slate-900 dark:bg-white border-slate-900 dark:border-white text-white dark:text-slate-900'
                      : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  {ENERGY_ICON[e]} {e}
                </button>
              ))}
            </div>
          </div>

          {/* Estimate + Due date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Estimate (min)</label>
              <input
                type="number"
                min={1}
                value={estimate}
                onChange={e => setEstimate(e.target.value)}
                placeholder="e.g. 45"
                className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Due date</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="px-5 pb-5 flex gap-2">
          <button
            onClick={onClose}
            className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 py-2 px-3 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!title.trim() || isPending}
            className="flex-1 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl py-2.5 text-sm font-semibold hover:opacity-80 transition-opacity disabled:opacity-40"
          >
            {isPending ? 'Creating…' : '+ Add task'}
          </button>
        </div>
      </div>
    </div>
  )
}
