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
  const isStaticFile = pathname.startsWith('/_next') || pathname.includes('.')

  if (isStaticFile) return supabaseResponse

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
