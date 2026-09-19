import { signOut } from '@/app/actions/auth'
import { LockedIcon } from '@/components/icons'

export default function ForbiddenPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="text-center max-w-sm px-6">
        <LockedIcon size={36} className="mx-auto mb-4 text-slate-400" />
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
          Access restricted
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          This planner is private. Sign in with the owner account to continue.
        </p>
        <form action={signOut}>
          <button
            type="submit"
            className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Sign out and try again
          </button>
        </form>
      </div>
    </div>
  )
}
