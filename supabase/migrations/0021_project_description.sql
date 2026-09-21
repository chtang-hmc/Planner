-- ─────────────────────────────────────────────────────────────────────────────
-- 0021 — what a project is for
--
-- The detail page has nowhere to say what a project actually is. The designer
-- called this "the main reason the page feels hollow", and they are right: a
-- page whose whole content is a task list and four counts is a list with
-- chrome. A sentence of intent is the thing that makes it a project.
--
-- Plain text, nullable, no default. NULL and '' both mean "not written yet"
-- and the UI draws the same empty state for either — a project created before
-- this ran is not different from one whose description was cleared, and making
-- the app distinguish them would be inventing a state nobody asked for.
--
-- Read through `select('*')` like everything else, so the app keeps working
-- before this migration runs: the column is simply absent and the field reads
-- as undefined, which the empty state already handles.
-- ─────────────────────────────────────────────────────────────────────────────

alter table projects
  add column if not exists description text;

comment on column projects.description is
  'What this project is for, in the user''s words. NULL or empty = never written.';
