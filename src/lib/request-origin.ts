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

/** The same, with the configured site as a fallback for requestless contexts. */
export function originOrConfigured(h: Headers): string {
  return originFrom(h)
    ?? process.env.NEXT_PUBLIC_SITE_URL
    ?? 'http://localhost:3000'
}
