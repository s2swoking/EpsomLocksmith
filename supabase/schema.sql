-- Appointment requests, one-locksmith dispatch, and private location sharing.
-- Run this in the Supabase SQL editor before configuring the static site.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

create table if not exists public.locksmiths (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  service text not null check (service in ('emergency_opening', 'lock_repair')),
  customer_name text not null check (length(customer_name) between 1 and 100),
  customer_phone text not null check (length(customer_phone) between 7 and 30),
  address text not null check (length(address) between 1 and 240),
  postcode text not null check (length(postcode) between 3 and 12),
  notes text check (notes is null or length(notes) <= 1000),
  appointment_start timestamptz not null,
  appointment_duration_minutes integer not null default 60 check (appointment_duration_minutes between 30 and 240),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'on_way', 'arrived', 'complete', 'cancelled')),
  assigned_locksmith_id uuid references public.locksmiths(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_dispatch_idx on public.jobs(status, appointment_start);
create index if not exists jobs_locksmith_schedule_idx on public.jobs(assigned_locksmith_id, appointment_start);

alter table public.jobs drop constraint if exists jobs_locksmith_no_overlap;
alter table public.jobs add constraint jobs_locksmith_no_overlap
  exclude using gist (
    assigned_locksmith_id with =,
    tstzrange(appointment_start, appointment_start + make_interval(mins => appointment_duration_minutes), '[)') with &&
  ) where (status in ('accepted', 'on_way', 'arrived'));

create table if not exists public.tracking_sessions (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  active boolean not null default true,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  accuracy_m integer check (accuracy_m is null or accuracy_m >= 0),
  updated_at timestamptz,
  sms_last_sent_at timestamptz
);
alter table public.tracking_sessions add column if not exists sms_last_sent_at timestamptz;

create table if not exists public.booking_submission_limits (
  ip_hash text primary key check (ip_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  submissions integer not null check (submissions >= 0)
);

alter table public.locksmiths enable row level security;
alter table public.jobs enable row level security;
alter table public.tracking_sessions enable row level security;
alter table public.booking_submission_limits enable row level security;

drop policy if exists locksmith_reads_own_profile on public.locksmiths;
create policy locksmith_reads_own_profile on public.locksmiths for select to authenticated
  using (auth_user_id = (select auth.uid()));

drop policy if exists public_can_request_jobs on public.jobs;

drop policy if exists locksmith_reads_assigned_jobs on public.jobs;
create policy locksmith_reads_assigned_jobs on public.jobs for select to authenticated
  using (assigned_locksmith_id in (select id from public.locksmiths where auth_user_id = (select auth.uid()))
    or (status = 'pending' and exists (select 1 from public.locksmiths where auth_user_id = (select auth.uid()) and active)));

revoke all on public.locksmiths, public.jobs, public.tracking_sessions, public.booking_submission_limits from anon, authenticated;
grant select on public.locksmiths, public.jobs to authenticated;

create or replace function public.current_locksmith_id()
returns uuid language sql stable security definer set search_path = public, auth
as $$ select id from public.locksmiths where auth_user_id = auth.uid() and active limit 1 $$;

create or replace function public.is_current_locksmith()
returns boolean language sql stable security definer set search_path = public, auth
as $$ select exists (select 1 from public.locksmiths where auth_user_id = auth.uid() and active) $$;

create or replace function public.accept_job(p_job_id uuid)
returns void language plpgsql security definer set search_path = public, auth
as $$
declare v_locksmith uuid := public.current_locksmith_id();
begin
  if v_locksmith is null then raise exception 'Staff account is not enabled.'; end if;
  update public.jobs set status = 'accepted', assigned_locksmith_id = v_locksmith, updated_at = now()
    where id = p_job_id and status = 'pending';
  if not found then raise exception 'This request is no longer pending.'; end if;
exception when exclusion_violation then
  raise exception 'This time overlaps another confirmed job. Ask the customer to choose another time.';
end $$;

create or replace function public.start_job_tracking(p_job_id uuid, p_token_hash text)
returns timestamptz language plpgsql security definer set search_path = public, auth
as $$
declare v_locksmith uuid := public.current_locksmith_id(); v_expiry timestamptz := now() + interval '4 hours';
begin
  if v_locksmith is null then raise exception 'Staff account is not enabled.'; end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Tracking token is invalid.'; end if;
  update public.jobs set status = 'on_way', updated_at = now()
    where id = p_job_id and assigned_locksmith_id = v_locksmith and status = 'accepted';
  if not found then raise exception 'Accept this job before starting its journey.'; end if;
  insert into public.tracking_sessions(job_id, token_hash, expires_at, active)
    values (p_job_id, p_token_hash, v_expiry, true)
    on conflict (job_id) do update set token_hash = excluded.token_hash, expires_at = excluded.expires_at,
      active = true, latitude = null, longitude = null, accuracy_m = null, updated_at = null, sms_last_sent_at = null;
  return v_expiry;
end $$;

create or replace function public.record_job_location(p_job_id uuid, p_latitude double precision, p_longitude double precision, p_accuracy_m integer)
returns void language plpgsql security definer set search_path = public, auth
as $$
declare v_locksmith uuid := public.current_locksmith_id();
begin
  if v_locksmith is null or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'Location update is invalid.';
  end if;
  update public.tracking_sessions s set latitude = p_latitude, longitude = p_longitude,
      accuracy_m = greatest(0, coalesce(p_accuracy_m, 0)), updated_at = now()
    from public.jobs j where s.job_id = p_job_id and j.id = s.job_id
      and j.assigned_locksmith_id = v_locksmith and j.status = 'on_way'
      and s.active and s.expires_at > now();
  if not found then raise exception 'Location session is no longer active.'; end if;
end $$;

create or replace function public.advance_job(p_job_id uuid, p_new_status text)
returns void language plpgsql security definer set search_path = public, auth
as $$
declare v_locksmith uuid := public.current_locksmith_id();
begin
  if v_locksmith is null then raise exception 'Staff account is not enabled.'; end if;
  if p_new_status not in ('arrived', 'complete') then raise exception 'That job update is not allowed.'; end if;
  update public.jobs set status = p_new_status, updated_at = now()
    where id = p_job_id and assigned_locksmith_id = v_locksmith
      and ((p_new_status = 'arrived' and status = 'on_way') or (p_new_status = 'complete' and status = 'arrived'));
  if not found then raise exception 'Update the job from its current status.'; end if;
  if p_new_status in ('arrived', 'complete') then
    update public.tracking_sessions set active = false, latitude = null, longitude = null, accuracy_m = null
      where job_id = p_job_id;
  end if;
end $$;

create or replace function public.get_public_tracking(p_token_hash text)
returns table(status text, latitude double precision, longitude double precision, updated_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select j.status,
    case when s.active and s.expires_at > now() then s.latitude else null end,
    case when s.active and s.expires_at > now() then s.longitude else null end,
    case when s.active and s.expires_at > now() then s.updated_at else null end
  from public.tracking_sessions s join public.jobs j on j.id = s.job_id
  where s.token_hash = p_token_hash and s.expires_at > now()
  limit 1
$$;

create or replace function public.get_job_tracking_sms_details(p_job_id uuid)
returns table(customer_phone text)
language plpgsql security definer set search_path = public, auth
as $$
declare v_phone text;
begin
  update public.tracking_sessions s set sms_last_sent_at = now()
    from public.jobs j where s.job_id = p_job_id and j.id = s.job_id
      and j.assigned_locksmith_id = public.current_locksmith_id() and j.status = 'on_way'
      and s.active and s.expires_at > now()
      and (s.sms_last_sent_at is null or s.sms_last_sent_at < now() - interval '90 seconds')
    returning j.customer_phone into v_phone;
  if v_phone is null then raise exception 'Tracking SMS was just sent, or this job is no longer active.'; end if;
  return query select v_phone;
end $$;

create or replace function public.purge_expired_tracking_sessions()
returns void language sql security definer set search_path = public
as $$ delete from public.tracking_sessions where expires_at <= now() $$;

create or replace function public.create_booking_request(
  p_ip_hash text, p_service text, p_customer_name text, p_customer_phone text,
  p_address text, p_postcode text, p_notes text, p_appointment_start timestamptz,
  p_appointment_duration_minutes integer
) returns void language plpgsql security definer set search_path = public
as $$
declare v_started timestamptz; v_submissions integer;
begin
  if p_ip_hash !~ '^[0-9a-f]{64}$' then raise exception 'Booking request could not be validated.'; end if;
  delete from public.booking_submission_limits where window_started_at < now() - interval '2 hours';
  if p_service not in ('emergency_opening', 'lock_repair')
    or length(trim(p_customer_name)) not between 1 and 100
    or length(trim(p_customer_phone)) not between 7 and 30
    or length(trim(p_address)) not between 1 and 240
    or length(trim(p_postcode)) not between 3 and 12
    or (p_notes is not null and length(p_notes) > 1000)
    or p_appointment_duration_minutes not between 30 and 240 then
    raise exception 'Check the booking details and try again.';
  end if;

  insert into public.booking_submission_limits(ip_hash, window_started_at, submissions)
    values (p_ip_hash, now(), 1)
    on conflict (ip_hash) do update set
      window_started_at = case when booking_submission_limits.window_started_at < now() - interval '1 hour' then now() else booking_submission_limits.window_started_at end,
      submissions = case when booking_submission_limits.window_started_at < now() - interval '1 hour' then 1 else booking_submission_limits.submissions + 1 end
    returning window_started_at, submissions into v_started, v_submissions;
  if v_submissions > 5 then raise exception 'Too many requests from this connection. Please try again later or call the locksmith.'; end if;

  insert into public.jobs(service, customer_name, customer_phone, address, postcode, notes, appointment_start, appointment_duration_minutes)
  values (p_service, trim(p_customer_name), trim(p_customer_phone), trim(p_address), upper(trim(p_postcode)), nullif(trim(p_notes), ''), p_appointment_start, p_appointment_duration_minutes);
end $$;

revoke all on function public.current_locksmith_id() from public, anon;
revoke all on function public.is_current_locksmith() from public, anon;
revoke all on function public.accept_job(uuid) from public, anon;
revoke all on function public.start_job_tracking(uuid, text) from public, anon;
revoke all on function public.record_job_location(uuid, double precision, double precision, integer) from public, anon;
revoke all on function public.advance_job(uuid, text) from public, anon;
revoke all on function public.get_job_tracking_sms_details(uuid) from public, anon;
revoke all on function public.create_booking_request(text, text, text, text, text, text, text, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.purge_expired_tracking_sessions() from public, anon, authenticated;
grant execute on function public.current_locksmith_id(), public.is_current_locksmith() to authenticated;
grant execute on function public.accept_job(uuid), public.start_job_tracking(uuid, text),
  public.record_job_location(uuid, double precision, double precision, integer), public.advance_job(uuid, text),
  public.get_job_tracking_sms_details(uuid) to authenticated;
grant execute on function public.get_public_tracking(text) to anon, authenticated;
grant execute on function public.create_booking_request(text, text, text, text, text, text, text, timestamptz, integer) to service_role;
grant execute on function public.purge_expired_tracking_sessions() to service_role;

-- Set up the first staff login in Supabase Auth, then link it to one locksmith row:
-- insert into public.locksmiths(auth_user_id, display_name)
-- values ('AUTH-USER-UUID', 'Local locksmith');
-- Schedule select public.purge_expired_tracking_sessions(); once daily using Supabase Cron.
