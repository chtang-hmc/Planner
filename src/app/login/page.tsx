'use client'

import { useState } from 'react'
import { signInWithGoogle } from '@/app/actions/auth'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function handleGoogle() {
    setLoading(true)
    setError(null)
    try {
      await signInWithGoogle()
      // signInWithGoogle redirects — this line is only reached on error
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 w-full max-w-sm shadow-sm">
        {/* Header */}
        <div className="mb-8">
          <div className="w-8 h-8 rounded-lg bg-teal-500 mb-4 flex items-center justify-center">
            <span className="text-white text-sm font-bold">P</span>
          </div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Planner</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Sign in to your workspace</p>
        </div>

        {/* Google button */}
        <button
          onClick={handleGoogle}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 py-2.5 px-4 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {/* Google logo */}
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.909-2.259c-.806.54-1.837.86-3.047.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          {loading ? 'Redirecting…' : 'Continue with Google'}
        </button>

        {error && (
          <p className="mt-3 text-xs text-red-500 dark:text-red-400 text-center">{error}</p>
        )}
      </div>
    </div>
  )
}
