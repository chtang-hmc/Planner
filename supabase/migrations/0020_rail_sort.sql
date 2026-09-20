-- ─────────────────────────────────────────────────────────────────────────────
-- 0020 — how the unplaced rail is ordered
--
-- A working preference, not view state. The rail is what Triage reads from, so
-- its order is the order decisions get made in — and someone who works largest
-- first should not have to re-choose that on every navigation, or find their
-- phone disagreeing with their laptop about what to do next.
--
-- Hence a column rather than localStorage: the two surfaces have to agree, and
-- localStorage cannot make them.
--
-- Nullable, and read through a fallback, so the app keeps working before this
-- runs. Default is largest-first: the deficit is denominated in minutes, and
-- one decision on a two-hour task clears more than four decisions on
-- fifteen-minute ones.
-- ─────────────────────────────────────────────────────────────────────────────

alter table user_scheduling_config
  add column if not exists rail_sort text;

do $$ begin
  alter table user_scheduling_config
    add constraint user_scheduling_config_rail_sort_check
    check (rail_sort is null or rail_sort in ('size', 'urgency', 'project'));
exception when duplicate_object then null;
end $$;

comment on column user_scheduling_config.rail_sort is
  'Order of the unplaced rail on Home. NULL = never chosen; the app falls back to size.';
