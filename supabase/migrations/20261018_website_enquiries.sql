begin;

create table if not exists public.website_enquiries (
  id uuid primary key,
  created_at timestamptz not null default now(),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  client_hash text not null check (client_hash ~ '^[a-f0-9]{64}$'),
  name text not null check (length(name) between 1 and 100),
  phone text not null check (length(phone) between 1 and 40),
  email text not null check (length(email) between 1 and 254),
  postcode text not null check (length(postcode) between 1 and 12),
  service text not null check (length(service) between 1 and 100),
  message text not null check (length(message) between 1 and 3000),
  attachment_path text,
  attachment_name text,
  attachment_type text,
  attachment_size integer check (attachment_size between 1 and 3000000),
  attachment_ready boolean not null default true,
  notification_status text not null default 'pending'
    check (notification_status in ('pending', 'sending', 'sent')),
  notification_attempts integer not null default 0,
  notification_attempted_at timestamptz,
  notified_at timestamptz,
  notification_message_id text
);

alter table public.website_enquiries enable row level security;
revoke all on public.website_enquiries from anon, authenticated;
grant select, insert, update on public.website_enquiries to service_role;

create index if not exists website_enquiries_client_time
  on public.website_enquiries(client_hash, created_at);
create index if not exists website_enquiries_pending
  on public.website_enquiries(created_at)
  where notification_status <> 'sent';

insert into storage.buckets
  (id, name, public, file_size_limit, allowed_mime_types)
values (
  'website-enquiries', 'website-enquiries', false, 3000000,
  array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.reserve_website_enquiry(
  p_id uuid, p_hash text, p_client_hash text, p_fields jsonb, p_attachment jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  existing public.website_enquiries%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_client_hash, 0));
  select * into existing from public.website_enquiries where id = p_id;
  if found then
    if existing.request_hash <> p_hash then
      return jsonb_build_object('error', 'ID_CONFLICT');
    end if;
    return jsonb_build_object('id', existing.id, 'attachment_ready', existing.attachment_ready,
      'notification_status', existing.notification_status);
  end if;
  if (select count(*) from public.website_enquiries
      where client_hash = p_client_hash and created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('error', 'RATE_LIMIT');
  end if;
  insert into public.website_enquiries
    (id, request_hash, client_hash, name, phone, email, postcode, service, message,
     attachment_path, attachment_name, attachment_type, attachment_size, attachment_ready)
  values (
    p_id, p_hash, p_client_hash,
    p_fields->>'name', p_fields->>'phone', p_fields->>'email',
    p_fields->>'postcode', p_fields->>'service', p_fields->>'message',
    p_attachment->>'path', p_attachment->>'name', p_attachment->>'type',
    (p_attachment->>'size')::integer, p_attachment is null
  );
  return jsonb_build_object('id', p_id, 'attachment_ready', p_attachment is null,
    'notification_status', 'pending');
end;
$function$;

create or replace function public.claim_website_notification(p_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $function$
declare
  claimed integer;
begin
  update public.website_enquiries set
    notification_status = 'sending',
    notification_attempts = notification_attempts + 1,
    notification_attempted_at = now()
  where id = p_id and attachment_ready = true
    and notification_status <> 'sent'
    and (notification_status = 'pending'
      or notification_attempted_at < now() - interval '5 minutes');
  get diagnostics claimed = row_count;
  return claimed = 1;
end;
$function$;

revoke all on function public.reserve_website_enquiry(uuid,text,text,jsonb,jsonb)
  from public, anon, authenticated;
revoke all on function public.claim_website_notification(uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_website_enquiry(uuid,text,text,jsonb,jsonb)
  to service_role;
grant execute on function public.claim_website_notification(uuid)
  to service_role;

notify pgrst, 'reload schema';
commit;

select
  'website_enquiries' as enquiry_table,
  (select relrowsecurity from pg_class
    where oid = 'public.website_enquiries'::regclass) as row_security_enabled,
  (select not public from storage.buckets
    where id = 'website-enquiries') as attachments_private;

