'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import { createProject, updateProject } from '@/app/actions/projects'
import { Project } from '@/types'

const PRESET_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#64748b', // slate
  '#a16207', // amber-dark
]

interface Props {
  /** Pass an existing project to edit; omit to create */
  project?: Project
  onClose: () => void
}

export default function ProjectModal({ project, onClose }: Props) {
  const isEdit = !!project

  const [name, setName]   = useState(project?.name ?? '')
  const [color, setColor] = useState(project?.color ?? PRESET_COLORS[0])
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  function handleSubmit() {
    if (!name.trim()) { setError('Name is required'); return }
    setError(null)
    startTransition(async () => {
      try {
        if (isEdit) {
          await updateProject(project!.id, name, color)
        } else {
          await createProject(name, color)
        }
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-slate-950/40 dark:bg-slate-950/60" />

      <div
        className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-6 flex flex-col gap-5"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {isEdit ? 'Edit project' : 'New project'}
        </h2>

        {/* Preview dot + name input */}
        <div className="flex items-center gap-3">
          <div
            className="w-4 h-4 rounded-full shrink-0 ring-2 ring-offset-2 ring-slate-200 dark:ring-slate-700"
            style={{ background: color }}
          />
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
            placeholder="Project name"
            className="flex-1 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Color picker */}
        <div>
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Color</p>
          <div className="flex flex-wrap gap-2">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full transition-transform hover:scale-110 ${
                  color === c ? 'ring-2 ring-offset-2 ring-slate-400 dark:ring-slate-500 scale-110' : ''
                }`}
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 py-2 px-3 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || isPending}
            className="flex-1 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl py-2.5 text-sm font-semibold hover:opacity-80 transition-opacity disabled:opacity-40"
          >
            {isPending ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save changes' : 'Create project')}
          </button>
        </div>
      </div>
    </div>
  )
}
