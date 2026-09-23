import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh the session — MUST be called before any redirect logic
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  // `/help` is reference material — syntax tables, no data of any kind — and a
  // page you must log in to read is a poor place to explain how to type into a
  // box. Kept alongside the auth routes so the single-owner check below skips
  // it too: it is public to everyone or it is not public at all.
  const isAuthRoute  = pathname === '/login' || pathname.startsWith('/auth')
                     || pathname.startsWith('/help') || pathname === '/403'

  /**
   * Scheduled jobs carry no session, so the gate cannot judge them and would
   * bounce every one to `/login`. They authenticate themselves against
   * `CRON_SECRET` instead — see `api/cron/sync-calendar`. Exempted by exact
   * prefix, and every route under it must do its own check.
   */
  const isCronRoute = pathname.startsWith('/api/cron/')

  /**
   * A real static file, not "anything with a dot in it".
   *
   * This used to be `pathname.includes('.')`, which is true of `/logo.png` and
   * equally true of `/projects/anything.else` — and the check returns *before*
   * the session and owner checks below, so a dot in a URL skipped the gate
   * entirely. Verified against the deployment on 2026-09-22: `/projects/a.b`
   * returned 404 from the page itself, with nobody signed in, having already
   * queried the database with the service-role key. `/projects/abc` redirected
   * to `/login` as it should.
   *
   * Nothing was exploitable, because the only dynamic route takes UUIDs and a
   * UUID has no dot. That is luck rather than a security property, and it
   * expires the first time someone adds a route that takes a slug.
   *
   * An extension allow-list instead. The matcher in `config` already excludes
   * most of these; this is the second line, and the two should not disagree
   * about what a file is.
   */
  const isStaticFile = pathname.startsWith('/_next')
    || /\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml|woff2?|ttf)$/i.test(pathname)

  if (isStaticFile || isCronRoute) return supabaseResponse

  // Send unauthenticated users to login
  if (!user && !isAuthRoute) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Enforce single-owner access: if ALLOWED_EMAIL is set, reject anyone else
  const allowedEmail = process.env.ALLOWED_EMAIL
  if (user && allowedEmail && user.email !== allowedEmail && !isAuthRoute) {
    return NextResponse.redirect(new URL('/403', request.url))
  }

  // Send already-logged-in, allowed users away from login — to Home, which is
  // now a real page rather than a redirect to /tasks.
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
