create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  created_at timestamptz default now()
);

insert into public.app_users (username, password_hash, profile_id)
select username, password_hash, id
from public.profiles
where username is not null
  and password_hash is not null
on conflict (username) do nothing;

alter table public.app_users enable row level security;

grant usage on schema public to anon, authenticated;
grant insert on public.app_users to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'app_users'
      and policyname = 'Allow app user registration'
  ) then
    create policy "Allow app user registration"
      on public.app_users
      for insert
      to anon, authenticated
      with check (true);
  end if;
end $$;

create or replace function public.app_username_exists(input_username text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_users
    where app_users.username = lower(trim(input_username))
  );
$$;

create or replace function public.verify_app_login(input_username text, input_password_hash text)
returns table(profile_id uuid)
language sql
security definer
set search_path = public
as $$
  select app_users.profile_id
  from public.app_users
  where app_users.username = lower(trim(input_username))
    and app_users.password_hash = input_password_hash
  limit 1;
$$;

grant execute on function public.app_username_exists(text) to anon, authenticated;
grant execute on function public.verify_app_login(text, text) to anon, authenticated;

alter table public.profiles drop column if exists password_hash;
