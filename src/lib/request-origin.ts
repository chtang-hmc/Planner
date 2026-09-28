/**
 * The origin the browser actually asked from.
 *
 * One definition, because two places need it and they have to agree: the
 * sign-in action builds `redirectTo` from it, and the OAuth callback builds
 * the address it sends you to afterwards. If they disagree you get sent to
 * Google from one host and returned to another, which is a sign-in that
 * completes and then lands nowhere.
 *
 * **Not `new URL(request.url).origin`.** That is what the callback used, and on
 * a request to `http://172.28.151.110:3000/auth/callback` it resolved to
 * `http://localhost:3000` — so signing in from a phone ended on the laptop's
 * own address. The headers are what the browser sent; `request.url` has been
 * through Next.
 *
 * The host header is attacker-controllable, and the usual worry is an open
 * redirect. It is not one here: Supabase refuses any `redirectTo` outside the
 * project's redirect allow-list, so the allow-list is the control, and the
 * callback only ever redirects to a path on this same origin.
 */
export function originFrom(h: Headers): string | null {
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (!host) return null

  // A tunnel or a load balancer terminates TLS in front of us and says so. A
  // bare hostname without that header is plain HTTP in development, and an
  // address starting with a digit is never anything else.
  const proto = h.get('x-forwarded-proto')
    ?? (host.startsWith('localhost') || /^\d/.test(host) ? 'http' : 'https')

  return `${proto}://${host}`
}

/**
 * The same, for the two callers that must have an origin: the sign-in action
 * and the OAuth callback.
 *
 * **It throws in production rather than guessing.** It used to end in
 * `?? 'http://localhost:3000'`, which is the right answer in development and
 * the worst possible one in production: a deployed sign-in would have sent the
 * user to their own laptop, silently, which is precisely the bug that made
 * signing in from a phone impossible (see `originFrom` above). Both callers
 * run on a real HTTP request, where `Host` is mandatory, so the throw should
 * be unreachable — and if it ever fires, a 500 naming the cause beats a
 * redirect nobody can follow.
 *
 * `NEXT_PUBLIC_SITE_URL` is an optional override for a proxy that strips the
 * header. Nothing needs it today.
 */
export function originOrConfigured(h: Headers): string {
  const origin = originFrom(h) ?? process.env.NEXT_PUBLIC_SITE_URL
  if (origin) return origin

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Cannot determine the request origin: no Host or X-Forwarded-Host header, ' +
      'and NEXT_PUBLIC_SITE_URL is unset.',
    )
  }
  return 'http://localhost:3000'
}
