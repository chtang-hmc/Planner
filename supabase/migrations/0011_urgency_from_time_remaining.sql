-- Rewrite the nightly urgency job to match the new formula in
-- src/types/index.ts (computeUrgency).
--
-- The old version divided elapsed time by (due_date - created_at), which put
-- the creation date in the denominator: two tasks with the same priority and
-- the same deadline scored differently purely because one was written down
-- earlier. Pressure now depends only on time REMAINING, so the score is
-- comparable across every task in the list.
--
-- priority (10-40) + time pressure (0-60), capped at 100
--   ramp    = 0 when the deadline is >= 14 days out, 1 at the deadline
--   on-time = shape(ramp) * 50
--   overdue = up to +10 more over the following 7 days
create or replace function recompute_urgency_scores()
returns void language plpgsql as $$
declare
  t             tasks%rowtype;
  horizon_days  constant real := 14;
  days_left     real;
  ramp          real;
  shaped        real;
  priority_pts  real;
  pressure      real;
  new_score     real;
begin
  for t in select * from tasks where status in ('inbox', 'active') loop
    priority_pts := t.priority * 10;  -- 10 | 20 | 30 | 40

    if t.due_date is null then
      new_score := least(priority_pts, 100);
    else
      days_left := extract(epoch from (t.due_date - now())) / 86400.0;
      ramp      := greatest(0, least(1 - days_left / horizon_days, 1));

      -- 0..1 multiplier; normalised so each curve reaches exactly 1 at the deadline
      shaped := case t.urgency_curve
        when 'linear' then ramp
        when 'exponential' then
          ((1.0 / (1 + exp(-10 * (ramp - 0.75)))) - (1.0 / (1 + exp(7.5))))
          / ((1.0 / (1 + exp(-2.5)))             - (1.0 / (1 + exp(7.5))))
        when 'step' then case
                           when ramp > 0.85 then 1.0
                           when ramp > 0.60 then 0.4
                           else 0.08
                         end
      end;

      pressure := shaped * 50
                + case when days_left < 0
                       then least(1, (-days_left) / 7.0) * 10
                       else 0 end;

      new_score := least(priority_pts + pressure, 100);
    end if;

    update tasks set urgency_score = new_score where id = t.id;
  end loop;
end;
$$;
