'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Task, Project, EnergyLevel, INBOX_PROJECT } from '@/types'
import TaskDetail from './TaskDetail'

const ENERGY_ICON: Record<EnergyLevel, string> = { low: '🌿', medium: '⚡', high: '🔥' }

function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-accent-100 dark:bg-accent-900 text-accent-800 dark:text-accent-200 rounded-sm not-italic">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  )
}

function formatDue(iso: string | null): { text: string; cls: string } | null {
  if (!iso) return null
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
  if (diff < 0)  return { text: 'Overdue',  cls: 'text-red-500' }
  if (diff === 0) return { text: 'Today',    cls: 'text-red-500' }
  if (diff === 1) return { text: 'Tomorrow', cls: 'text-amber-500' }
  return { text: `${diff}d`,    cls: 'text-slate-400' }
}

type SearchTask = Task & { project: Project }

interface Props {
  allProjects: Project[]
}

export default function SearchModal({ allProjects }: Props) {
  const [open,    setOpen]    = useState(false)
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState<SearchTask[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<SearchTask | null>(null)
  const [cursor,  setCursor]  = useState(0)

  const inputRef   = useRef<HTMLInputElement>(null)
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listRef    = useRef<HTMLDivElement>(null)

  // ── Global Cmd/Ctrl+K shortcut ──────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Focus input when opening
  useEffect(() => {
    if (open) {
      setQuery(''); setResults([]); setCursor(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  // ── Search with debounce ────────────────────────────────────────────────

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setLoading(false); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
      const { tasks } = await res.json()
      setResults(tasks ?? [])
      setCursor(0)
    } finally {
      setLoading(false)
    }
  }, [])

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value
    setQuery(q)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => search(q), 180)
  }

  // ── Keyboard navigation ─────────────────────────────────────────────────

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape')     { setOpen(false); return }
    if (e.key === 'ArrowDown')  { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)) }
    if (e.key === 'ArrowUp')    { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    if (e.key === 'Enter' && results[cursor]) { setSelected(results[cursor]) }
  }

  // Scroll cursor into view
  useEffect(() => {
    const el = listRef.current?.children[cursor] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  if (!open && !selected) return null

  return (
    <>
      {/* ── Search overlay ── */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
          onClick={() => setOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-slate-950/40 dark:bg-slate-950/60 backdrop-blur-sm" />

          {/* Panel */}
          <div
            className="relative w-full max-w-xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
            onKeyDown={onKeyDown}
          >
            {/* Input */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100 dark:border-slate-800">
              <span className="text-slate-400 text-base shrink-0">
                {loading ? (
                  <span className="inline-block w-4 h-4 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
                ) : '⌕'}
              </span>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={handleInput}
                placeholder="Search tasks…"
                className="flex-1 text-sm text-slate-900 dark:text-slate-100 bg-transparent focus:outline-none placeholder:text-slate-400"
              />
              <kbd className="hidden sm:inline-flex text-xs text-slate-300 dark:text-slate-600 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-mono">
                esc
              </kbd>
            </div>

            {/* Results */}
            {results.length > 0 ? (
              <div ref={listRef} className="overflow-y-auto max-h-96 py-1">
                {results.map((task, i) => {
                  const proj = task.project ?? INBOX_PROJECT
                  const due  = formatDue(task.due_date)
                  const isDone = task.status === 'done'
                  return (
                    <button
                      key={task.id}
                      onClick={() => { setSelected(task); setOpen(false) }}
                      onMouseEnter={() => setCursor(i)}
                      className={`w-full text-left flex items-center gap-3 px-4 py-2.5 transition-colors ${
                        cursor === i
                          ? 'bg-accent-50 dark:bg-accent-950'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      {/* Status dot */}
                      <span className={`w-2 h-2 rounded-full shrink-0 mt-0.5 ${
                        isDone ? 'bg-slate-300 dark:bg-slate-600'
                          : task.urgency_score >= 70 ? 'bg-red-400'
                          : task.urgency_score >= 40 ? 'bg-amber-400'
                          : 'bg-slate-200 dark:bg-slate-700'
                      }`} />

                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium leading-snug ${
                          isDone ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200'
                        }`}>
                          {highlight(task.title, query)}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span
                            className="text-xs font-medium px-1.5 py-0.5 rounded"
                            style={{ background: proj.color + '20', color: proj.color }}
                          >
                            {proj.name}
                          </span>
                          {ENERGY_ICON[task.energy_required] && (
                            <span className="text-xs text-slate-400">{ENERGY_ICON[task.energy_required]}</span>
                          )}
                          {due && <span className={`text-xs ${due.cls}`}>{due.text}</span>}
                          {task.type !== 'task' && (
                            <span className="text-xs text-slate-400 capitalize">{task.type}</span>
                          )}
                        </div>
                      </div>

                      <span className="text-xs text-slate-300 dark:text-slate-600 shrink-0 font-mono">↵</span>
                    </button>
                  )
                })}
              </div>
            ) : query && !loading ? (
              <div className="py-10 text-center text-slate-400 text-sm">
                No tasks found for <span className="font-medium text-slate-600 dark:text-slate-300">"{query}"</span>
              </div>
            ) : !query ? (
              <div className="py-8 text-center text-slate-300 dark:text-slate-600 text-xs">
                Type to search tasks…
              </div>
            ) : null}

            {/* Footer hint */}
            {results.length > 0 && (
              <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-4 text-xs text-slate-300 dark:text-slate-600">
                <span><kbd className="font-mono">↑↓</kbd> navigate</span>
                <span><kbd className="font-mono">↵</kbd> open</span>
                <span><kbd className="font-mono">esc</kbd> close</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TaskDetail for selected result ── */}
      {selected && (
        <TaskDetail
          task={{ ...selected, project: selected.project ?? INBOX_PROJECT }}
          projects={allProjects}
          streak={null}
          gcalWriteEnabled={false}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}
