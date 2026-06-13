alter table public.water_log drop constraint if exists water_log_user_date_key;
alter table public.water_log drop constraint if exists water_log_date_key;
drop index if exists public.water_log_user_date_key;
drop index if exists public.water_log_date_key;

alter table public.water_log add column if not exists goal integer default 8;

update public.water_log
set goal = greatest(1, ceil(coalesce(target_ml, 2000)::numeric / 250)::integer)
where target_ml is not null;

delete from public.water_log kept
using public.water_log duplicate
where kept.user_id = duplicate.user_id
  and kept.date = duplicate.date
  and kept.id < duplicate.id;

alter table public.water_log
  add constraint water_log_user_date_key unique (user_id, date);
