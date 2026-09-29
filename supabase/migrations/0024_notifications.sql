-- ─────────────────────────────────────────────────────────────────────────────
-- 0024 — scheduled notifications
--
-- Three parts, run together after 0023 and after the deploy that adds
-- /api/cron/notify:
--
--   1. notification_prefs — which notifications, and at what times.
--   2. notification_log   — what has been sent, so each goes out once.
--   3. the pg_cron job    — every five minutes, call /api/cron/notify.
--
-- ── Before running part 3 ────────────────────────────────────────────────────
--
-- The job authenticates with NOTIFY_CRON_SECRET: its own secret, not the
-- calendar sync's CRON_SECRET, so either can be replaced alone. It reads it
-- from Supabase Vault, so the value is never in this file. Once, in the SQL
-- editor, with the same value that is in Vercel:
--
--   select vault.create_secret('<the NOTIFY_CRON_SECRET value>', 'notify_cron_secret');
--
-- Without it the header is empty and the route answers 401: nothing is sent,
-- nothing breaks.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Preferences ───────────────────────────────────────────────────────────
-- One jsonb column rather than a column per switch: the set of notifications
-- will change, and `normalizePrefs` in lib/notify.ts fills anything missing
-- with its default, so an empty object is "everything on at the default times".
alter table user_scheduling_config
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

-- ── 2. What has been sent ────────────────────────────────────────────────────
-- The key names the send: 'morning:2026-09-29', 'habits:2026-09-29',
-- 'milestone:Piano:30d:2026-10-12'. The scheduler inserts the key before
-- sending and only sends if the insert won, so two overlapping ticks cannot
-- both notify. Rows are tiny and a year is ~1,100 of them; not worth pruning.
create table if not exists notification_log (
  key      text        primary key,
  sent_at  timestamptz not null default now()
);

comment on table notification_log is
  'One row per notification sent, keyed by what it was. The insert is the lock that makes each send happen once.';

alter table notification_log enable row level security;
create policy "authenticated full access" on notification_log for all to authenticated using (true);

-- ── 3. The schedule ──────────────────────────────────────────────────────────
-- pg_net makes the HTTP call; pg_cron fires it. Every five minutes, which is
-- the precision of every send time (8:00, not 8:03). The 30s timeout covers a
-- cold start; pg_net does not wait on the database for it.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('planner-notify')
where exists (select 1 from cron.job where jobname = 'planner-notify');

select cron.schedule(
  'planner-notify',
  '*/5 * * * *',
  $$
  select net.http_get(
    url     := 'https://planner-nine-snowy.vercel.app/api/cron/notify',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'notify_cron_secret'), '')
    ),
    timeout_milliseconds := 30000
  );
  $$
);
