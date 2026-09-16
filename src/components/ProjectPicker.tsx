'use client'

import { useState, useTransition } from 'react'
import { Project } from '@/types'
import { createProject } from '@/app/actions/projects'
import { PRESET_COLORS } from '@/components/ProjectModal'

interface Props {
  projects: Project[]
  /** Selected project id, or '' for none. */
  value:    string
  /** `project` is supplied whenever the id resolves to a known row, so callers
   *  can update their own display without waiting for a server refresh. */
  onChange: (projectId: string, project: Project | null) => void
}

/**
 * Project dropdown with inline creation.
 *
 * Shared by the add-task modal and the task detail panel: both need to pick a
 * project *and* to create one without leaving what you're doing, and having two
 * copies of the create-and-select flow would be two places to get it wrong.
 */
export default function ProjectPicker({ projects, value, onChange }: Props) {
  // Projects created here. The list is a server prop, so a new one wouldn't
  // appear until a refresh — hold it locally as well.
  const [created, setCreated] = useState<Project[]>([])
  const [creating, setCreating] = useState(false)
  const [name,  setName]  = useState('')
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const all = [...projects, ...created]

  function submit() {
    const trimmed = name.trim()
    if (!trimmed) return
    if (all.some(p => p.name.toLowerCase() === trimmed.toLowerCase())) {
      setError('You already have a project with that name')
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        const project = await createProject(trimmed, color)
        setCreated(prev => [...prev, project])
        onChange(project.id, project)   // select it straight away
        setCreating(false)
        setName('')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not create project')
      }
    })
  }

  if (!creating) {
    return (
      <select
        value={value}
        onChange={e => {
          const id = e.target.value
          if (id === '__new__') { setCreating(true); return }
          onChange(id, all.find(p => p.id === id) ?? null)
        }}
        className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500"
      >
        <option value="">— No project —</option>
        {all.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        <option value="__new__">+ New project…</option>
      </select>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input
        autoFocus
        type="text"
        value={name}
        onChange={e => { setName(e.target.value); setError(null) }}
        onKeyDown={e => {
          if (e.key === 'Enter')  { e.preventDefault(); submit() }
          if (e.key === 'Escape') { setCreating(false); setError(null) }
        }}
        placeholder="New project name"
        className="w-full border border-accent-300 dark:border-accent-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500"
      />
      <div className="flex items-center gap-1 flex-wrap">
        {PRESET_COLORS.slice(0, 8).map(c => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            aria-label={`Colour ${c}`}
            className={`w-4 h-4 rounded-full transition-transform ${
              color === c ? 'ring-2 ring-offset-1 ring-slate-400 dark:ring-offset-slate-900 scale-110' : ''
            }`}
            style={{ background: c }}
          />
        ))}
        <button
          type="button"
          onClick={submit}
          disabled={!name.trim()}
          className="ml-auto text-xs font-medium px-2 py-1 rounded-lg bg-accent-500 text-white disabled:opacity-40"
        >
          Create
        </button>
        <button
          type="button"
          onClick={() => { setCreating(false); setError(null) }}
          className="text-xs text-slate-400 px-1"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-amber-500">{error}</p>}
    </div>
  )
}
