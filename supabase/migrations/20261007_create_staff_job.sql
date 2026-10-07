-- Lets an authenticated, active locksmith record a job confirmed by phone.
create or replace function public.create_staff_job(
  p_service text, p_customer_name text, p_customer_phone text, p_address text,
  p_postcode text, p_notes text, p_appointment_start timestamptz,
  p_appointment_duration_minutes integer
) returns uuid language plpgsql security definer set search_path = public, auth
as $$
declare v_locksmith uuid := public.current_locksmith_id(); v_job_id uuid;
begin
  if v_locksmith is null then raise exception 'Staff account is not enabled.'; end if;
  if p_service not in ('emergency_opening', 'lock_repair')
    or length(trim(p_customer_name)) not between 1 and 100
    or length(trim(p_customer_phone)) not between 7 and 30
    or length(trim(p_address)) not between 1 and 240
    or length(trim(p_postcode)) not between 3 and 12
    or (p_notes is not null and length(p_notes) > 1000)
    or p_appointment_start is null
    or p_appointment_duration_minutes not between 30 and 240 then
    raise exception 'Check the job details and try again.';
  end if;

  insert into public.jobs(service, customer_name, customer_phone, address, postcode, notes,
      appointment_start, appointment_duration_minutes, status, assigned_locksmith_id)
    values (p_service, trim(p_customer_name), trim(p_customer_phone), trim(p_address),
      upper(trim(p_postcode)), nullif(trim(p_notes), ''), p_appointment_start,
      p_appointment_duration_minutes, 'accepted', v_locksmith)
    returning id into v_job_id;
  return v_job_id;
exception when exclusion_violation then
  raise exception 'This time overlaps another confirmed job. Choose another time.';
end $$;

revoke all on function public.create_staff_job(text, text, text, text, text, text, timestamptz, integer) from public, anon;
grant execute on function public.create_staff_job(text, text, text, text, text, text, timestamptz, integer) to authenticated;
