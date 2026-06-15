create extension if not exists pgcrypto;

alter table public.profiles enable row level security;
alter table public.profiles add column if not exists auth_user_id uuid;

revoke all on public.profiles from anon;
grant select, insert, update on public.profiles to authenticated;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
  loop
    execute format('drop policy if exists %I on public.profiles', policy_record.policyname);
  end loop;
end $$;

create policy "Profiles are owned by auth user"
  on public.profiles
  for all
  to authenticated
  using (id = auth.uid() or auth_user_id = auth.uid())
  with check (id = auth.uid() or auth_user_id = auth.uid());

create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username))
  where username is not null;

create unique index if not exists profiles_auth_user_id_key
  on public.profiles (auth_user_id)
  where auth_user_id is not null;

do $$
begin
  if to_regclass('auth.users') is not null then
    update public.profiles as linked_profiles
    set auth_user_id = linked_profiles.id
    where linked_profiles.auth_user_id is null
      and exists (
        select 1
        from auth.users as auth_users
        where auth_users.id = linked_profiles.id
      );
  end if;
end $$;

create or replace function public.auth_user_owns_profile(input_profile_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where profiles.id = input_profile_id
      and (profiles.id = auth.uid() or profiles.auth_user_id = auth.uid())
  );
$$;

revoke all on function public.auth_user_owns_profile(uuid) from public;
grant execute on function public.auth_user_owns_profile(uuid) to authenticated;

create or replace function public.profile_username_available(input_username text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.profiles
    where lower(username) = lower(trim(input_username))
  );
$$;

grant execute on function public.profile_username_available(text) to anon, authenticated;
revoke execute on function public.verify_app_login(text, text) from anon, authenticated;
revoke execute on function public.app_username_exists(text) from anon, authenticated;

do $$
declare
  table_record record;
  policy_record record;
begin
  for table_record in
    select table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'user_id'
      and table_name not in ('app_users', 'food_items')
      and table_name in (
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_type = 'BASE TABLE'
      )
    group by table_name
  loop
    execute format('alter table public.%I enable row level security', table_record.table_name);
    execute format('revoke all on public.%I from anon', table_record.table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_record.table_name);

    for policy_record in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = table_record.table_name
    loop
      execute format('drop policy if exists %I on public.%I', policy_record.policyname, table_record.table_name);
    end loop;

    execute format(
      'create policy %I on public.%I for all to authenticated using (public.auth_user_owns_profile(user_id)) with check (public.auth_user_owns_profile(user_id))',
      'Authenticated owner access',
      table_record.table_name
    );
  end loop;
end $$;

do $$
declare
  policy_record record;
begin
  if to_regclass('public.food_items') is null then
    return;
  end if;

  alter table public.food_items enable row level security;
  revoke all on public.food_items from anon;
  grant select, insert, update, delete on public.food_items to authenticated;

  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'food_items'
  loop
    execute format('drop policy if exists %I on public.food_items', policy_record.policyname);
  end loop;
end $$;

create policy "Authenticated users can read shared or owned foods"
  on public.food_items
  for select
  to authenticated
  using (user_id is null or public.auth_user_owns_profile(user_id));

create policy "Authenticated users can create owned foods"
  on public.food_items
  for insert
  to authenticated
  with check (public.auth_user_owns_profile(user_id));

create policy "Authenticated users can update owned foods"
  on public.food_items
  for update
  to authenticated
  using (public.auth_user_owns_profile(user_id))
  with check (public.auth_user_owns_profile(user_id));

create policy "Authenticated users can delete owned foods"
  on public.food_items
  for delete
  to authenticated
  using (public.auth_user_owns_profile(user_id));

do $$
declare
  policy_record record;
begin
  if to_regclass('public.meal_log_items') is null then
    return;
  end if;

  alter table public.meal_log_items enable row level security;
  revoke all on public.meal_log_items from anon;
  grant select, insert, update, delete on public.meal_log_items to authenticated;

  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'meal_log_items'
  loop
    execute format('drop policy if exists %I on public.meal_log_items', policy_record.policyname);
  end loop;
end $$;

create policy "Authenticated users can access owned meal log items"
  on public.meal_log_items
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.meal_logs
      where meal_logs.id = meal_log_items.meal_log_id
        and public.auth_user_owns_profile(meal_logs.user_id)
    )
  )
  with check (
    exists (
      select 1
      from public.meal_logs
      where meal_logs.id = meal_log_items.meal_log_id
        and public.auth_user_owns_profile(meal_logs.user_id)
    )
    and (
      food_item_id is null
      or exists (
        select 1
        from public.food_items
        where food_items.id = meal_log_items.food_item_id
          and (food_items.user_id is null or public.auth_user_owns_profile(food_items.user_id))
      )
    )
  );

do $$
declare
  policy_record record;
begin
  if to_regclass('public.meal_template_items') is null then
    return;
  end if;

  alter table public.meal_template_items enable row level security;
  revoke all on public.meal_template_items from anon;
  grant select, insert, update, delete on public.meal_template_items to authenticated;

  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'meal_template_items'
  loop
    execute format('drop policy if exists %I on public.meal_template_items', policy_record.policyname);
  end loop;
end $$;

create policy "Authenticated users can access owned meal template items"
  on public.meal_template_items
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.meal_templates
      where meal_templates.id = meal_template_items.meal_template_id
        and public.auth_user_owns_profile(meal_templates.user_id)
    )
  )
  with check (
    exists (
      select 1
      from public.meal_templates
      where meal_templates.id = meal_template_items.meal_template_id
        and public.auth_user_owns_profile(meal_templates.user_id)
    )
    and (
      food_item_id is null
      or exists (
        select 1
        from public.food_items
        where food_items.id = meal_template_items.food_item_id
          and (food_items.user_id is null or public.auth_user_owns_profile(food_items.user_id))
      )
    )
  );

do $$
declare
  policy_record record;
begin
  if to_regclass('public.app_users') is null then
    return;
  end if;

  alter table public.app_users enable row level security;
  revoke all on public.app_users from anon, authenticated;

  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'app_users'
  loop
    execute format('drop policy if exists %I on public.app_users', policy_record.policyname);
  end loop;
end $$;

drop function if exists public.set_task_completed(uuid, boolean);

create or replace function public.set_task_completed(input_task_id uuid, input_completed boolean)
returns table(
  id uuid,
  user_id uuid,
  title text,
  date date,
  time_block text,
  completed boolean,
  priority text,
  category text,
  notes text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.tasks
  set completed = input_completed
  where tasks.id = input_task_id
    and public.auth_user_owns_profile(tasks.user_id)
  returning
    tasks.id,
    tasks.user_id,
    tasks.title,
    tasks.date,
    tasks.time_block,
    tasks.completed,
    tasks.priority,
    tasks.category,
    tasks.notes,
    tasks.created_at;
end;
$$;

grant execute on function public.set_task_completed(uuid, boolean) to authenticated;
revoke execute on function public.set_task_completed(uuid, boolean) from anon;

create table if not exists public.ai_rate_limits (
  rate_limit_key text primary key,
  window_start timestamptz not null default now(),
  request_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.ai_rate_limits enable row level security;
revoke all on public.ai_rate_limits from anon, authenticated;

create or replace function public.consume_ai_rate_limit(
  input_key text,
  input_max_requests integer default 12,
  input_window_seconds integer default 60
)
returns table(
  allowed boolean,
  remaining integer,
  reset_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_window_start timestamptz;
  current_count integer;
  window_seconds integer := greatest(1, input_window_seconds);
  max_requests integer := greatest(1, input_max_requests);
begin
  if input_key is null or length(trim(input_key)) = 0 then
    return query select false, 0, window_seconds;
    return;
  end if;

  insert into public.ai_rate_limits as limits (rate_limit_key, window_start, request_count, updated_at)
  values (input_key, now(), 1, now())
  on conflict (rate_limit_key) do update
  set
    window_start = case
      when limits.window_start <= now() - make_interval(secs => window_seconds) then now()
      else limits.window_start
    end,
    request_count = case
      when limits.window_start <= now() - make_interval(secs => window_seconds) then 1
      else limits.request_count + 1
    end,
    updated_at = now()
  returning window_start, request_count
  into current_window_start, current_count;

  delete from public.ai_rate_limits
  where updated_at < now() - interval '1 day';

  return query
  select
    current_count <= max_requests,
    greatest(0, max_requests - current_count),
    greatest(1, ceil(extract(epoch from (current_window_start + make_interval(secs => window_seconds) - now())))::integer);
end;
$$;

revoke all on function public.consume_ai_rate_limit(text, integer, integer) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.consume_ai_rate_limit(text, integer, integer) to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';
