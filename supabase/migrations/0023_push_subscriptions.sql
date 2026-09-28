-- ─────────────────────────────────────────────────────────────────────────────
-- 0023 — push_subscriptions: where to deliver a notification
--
-- A subscription is one browser on one device agreeing to receive pushes: the
-- installed app on the iPhone is one, a desktop Chrome would be another. The
-- browser hands the page an endpoint URL on its push service (Apple's, for
-- iOS) plus two keys, and every notification is encrypted with those keys and
-- POSTed to that endpoint. That is all a row is.
--
-- ── Keyed on the endpoint ────────────────────────────────────────────────────
--
-- The endpoint is unique per subscription and is what the push service calls
-- it, so it is the natural key. Subscribing again from the same device returns
-- the same endpoint, and the upsert makes "Enable" idempotent rather than a
-- way to be notified twice.
--
-- ── Rows die on 404/410 ──────────────────────────────────────────────────────
--
-- There is no unsubscribe callback when someone deletes the home-screen app or
-- revokes permission in iOS Settings. The push service answers the next send
-- with 404 or 410 instead, and `lib/push.ts` deletes the row then. Other
-- failures are recorded in `last_error` and the row is kept: a 5xx from Apple
-- is Apple's afternoon, not a dead phone.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists push_subscriptions (
  endpoint     text        primary key,
  p256dh       text        not null,
  auth         text        not null,
  -- Which device this is, for telling two rows apart in Settings.
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_sent_at timestamptz,
  last_error   text
);

comment on table push_subscriptions is
  'One browser on one device that accepted push notifications. Deleted when the push service reports it gone (404/410).';

alter table push_subscriptions enable row level security;
create policy "authenticated full access" on push_subscriptions for all to authenticated using (true);
