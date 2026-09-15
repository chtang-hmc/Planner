'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Project } from '@/types'
import { signOut } from '@/app/actions/auth'
import EnergyLogger from './EnergyLogger'

const NAV = [
  { href: '/tasks',     label: 'Tasks',     icon: '✓' },
  { href: '/habits',    label: 'Habits',    icon: '◎' },
  { href: '/projects',  label: 'Projects',  icon: '⊞' },
  { href: '/review',    label: 'Review',    icon: '↻' },
  { href: '/analytics', label: 'Analytics', icon: '▸' },
]

export default function Sidebar({ projects }: { projects: Project[] }) {
  const path = usePathname()

  return (
    <aside className="w-52 shrink-0 flex flex-col h-full border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-5 px-3">
      {/* App name */}
      <div className="px-2 mb-6">
        <span className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">Planner</span>
      </div>

      {/* Primary nav */}
      <nav className="flex flex-col gap-0.5 mb-6">
        {NAV.map(({ href, label, icon }) => {
          const active = path === href || (href !== '/tasks' && path.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-accent-50 dark:bg-accent-950 text-accent-700 dark:text-accent-300 font-medium'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}
            >
              <span className={`text-xs font-mono w-4 text-center ${active ? 'text-accent-500' : 'opacity-50'}`}>
                {icon}
              </span>
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Projects */}
      <div className="px-2 mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-600">Projects</span>
      </div>
      <div className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
        {projects.map(p => (
          <Link
            key={p.id}
            href={`/projects/${p.id}`}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
            <span className="truncate">{p.name}</span>
          </Link>
        ))}
      </div>

      {/* Bottom */}
      <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-2">
        <EnergyLogger />

        {/* Settings link */}
        <Link
          href="/settings"
          className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
            path === '/settings'
              ? 'bg-accent-50 dark:bg-accent-950 text-accent-700 dark:text-accent-300 font-medium'
              : 'text-slate-400 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
          }`}
        >
          <span className="font-mono w-4 text-center">⚙</span>
          Settings
        </Link>

        <div className="px-2.5 text-xs text-slate-400 dark:text-slate-600">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
        </div>

        <form action={signOut}>
          <button
            type="submit"
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-400 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-left"
          >
            <span className="font-mono">→</span> Sign out
          </button>
        </form>
      </div>
    </aside>
  )
}
