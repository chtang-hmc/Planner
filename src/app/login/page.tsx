/**
 * Sign in, without needing the page to have hydrated.
 *
 * This was a client component whose button called the action from `onClick`.
 * That works only once React has hydrated, and when it has not — a phone on a
 * flaky connection, a chunk that did not arrive, an error thrown during
 * hydration — the button is inert and the page has no way to say so. Which is
 * exactly what it looked like: click, nothing.
 *
 * A form whose `action` is the server action needs none of that. With JS,
 * Next intercepts and posts it; without, the browser posts it natively and
 * follows the 303 itself. The one page you cannot get past if it fails should
 * be the one page that does not depend on JS.
 */

import { signInWithGoogle } from '@/app/actions/auth'
import SubmitButton from './SubmitButton'

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 w-full max-w-sm shadow-sm">
        {/* Header */}
        <div className="mb-8">
          <div className="w-8 h-8 rounded-lg bg-accent-500 mb-4 flex items-center justify-center">
            <span className="text-white text-sm font-bold">P</span>
          </div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Planner</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Sign in to your workspace</p>
        </div>

        {/* Google button */}
        <form action={signInWithGoogle}>
        <SubmitButton>
          {/* Google logo */}
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.909-2.259c-.806.54-1.837.86-3.047.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
        </SubmitButton>
        </form>

        {/* The callback route sends failures back here as `?error=`, which
            survives a full page load — a `useState` message does not. */}
        {error && (
          <p className="mt-3 text-xs text-red-500 dark:text-red-400 text-center">
            {error === 'auth-failed'
              ? 'Google sign-in did not complete. Try again.'
              : 'Something went wrong signing in.'}
          </p>
        )}
      </div>
    </div>
  )
}
