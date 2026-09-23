'use client'

/**
 * The submit button, and the only part of this page that needs JS.
 *
 * `useFormStatus` gives the pending state when React has hydrated. When it has
 * not, the button is still a submit button and the form still posts — it just
 * does not say "Redirecting…" on the way.
 */

import { useFormStatus } from 'react-dom'

export default function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full flex items-center justify-center gap-3 py-2.5 px-4 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {children}
      {pending ? 'Redirecting…' : 'Continue with Google'}
    </button>
  )
}
