# Booking and locksmith workflow setup

The existing site remains a static site. Supabase provides the database, staff sign-in and Edge Functions; Twilio is used only to send the private tracking SMS. The browser contains a Supabase URL and public anon key, while privileged keys stay in Supabase Edge Function secrets.

## Provision the backend

1. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql) in its SQL editor.
2. In Supabase Auth, enable email sign-in and add the deployed site's origin and `/staff.html` to the allowed redirect URLs.
3. Create the locksmith's Auth user in the dashboard, then link that user's UUID in the SQL editor:

   ```sql
   insert into public.locksmiths(auth_user_id, display_name)
   values ('AUTH-USER-UUID', 'Local locksmith');
   ```

4. Install the Supabase CLI on the deployment workstation, link this project, then deploy both Edge Functions from this folder:

   ```sh
   supabase link --project-ref YOUR_PROJECT_REF
   supabase functions deploy request-booking
   supabase functions deploy send-tracking-sms
   ```

5. Set these Edge Function secrets using the Supabase CLI or dashboard. Enter real secret values only in that secure settings flow:

   - `PUBLIC_SITE_URL`: the exact deployed site origin, with no trailing slash.
   - `BOOKING_RATE_LIMIT_SALT`: a randomly generated private value used to hash visitor IPs for request throttling.
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`: Twilio Messaging credentials and the SMS sender number in E.164 format.

   Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Never put the service role key or Twilio token in `dist/`.

6. Update `dist/workflow-config.js` with the Supabase project URL and its public anon key. The anon key is safe to include in browser code because the schema protects customer and staff data with row-level security and narrow RPC permissions.
7. In Supabase Cron, enable `pg_cron` and schedule expired tracking cleanup, for example:

   ```sql
   select cron.schedule(
     'purge-expired-locksmith-tracking',
     '*/30 * * * *',
     $$select public.purge_expired_tracking_sessions();$$
   );
   ```

## Workflow behavior

- An emergency request is recorded for now; other requests can ask for a future local date and time. Both remain pending until accepted.
- Accepting a job assigns the single configured locksmith. A database exclusion constraint prevents confirmed jobs from overlapping; pending requests may overlap until one is accepted.
- **On my way** starts a four-hour tracking session and sends the customer a Twilio SMS with a random, private link. Location updates are requested from the locksmith's phone while the page is open.
- The public tracking page shows only visit status and approximate location. It does not expose customer details. Arrival or completion immediately disables location sharing and clears stored coordinates; the link expires after four hours. The scheduled cleanup removes expired token records.
- Booking submissions are limited to five per visitor IP hash per hour. Raw IP addresses are not saved.
- Staff use a pre-created email account and sign in through a one-time email link at `/staff.html`.

## Validate after configuration and deployment

1. Submit an emergency request and a future lock-repair request from the public site. Confirm both appear as pending in the staff page.
2. Accept one request and confirm a second overlapping request cannot be accepted.
3. On a phone, press **On my way**, allow location access, and verify the customer receives the SMS. Open the link on another device and confirm the map location updates.
4. Press **Arrived** and confirm the public link stops showing location; press **Complete** and confirm the job leaves the active list.
5. Verify the same tracking link no longer returns a result after four hours and after the cleanup schedule runs.

Deploy the static files to the existing site project. Deploy Supabase schema and functions separately; static hosting alone cannot run the database or SMS backend.
