alter table public.profiles add column if not exists gender text;

update public.profiles
set gender = coalesce(gender, onboarding_profile->>'gender', 'male')
where gender is null;

notify pgrst, 'reload schema';
