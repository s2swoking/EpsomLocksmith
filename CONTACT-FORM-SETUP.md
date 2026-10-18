# Website enquiries

The existing website posts to `/api/contact`. The server saves each enquiry in the existing Supabase project's `website_enquiries` table. Optional files are stored in its private `website-enquiries` bucket. Customers do not sign in. Browser keys cannot read either resource.

Apply `supabase/migrations/20261018_website_enquiries.sql` once in Supabase's SQL Editor. This migration creates only the contact-form resources and service-role-only functions. Both privacy checks at the end must return true.

The existing Vercel integration supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Keep these server-side. `CONTACT_TO_EMAIL` is the private business Gmail address already configured in Production. No recipient address belongs in public HTML, JavaScript or repository configuration.

## Direct Gmail notifications

1. Sign in to the business Google account, enable 2-Step Verification if needed, and create an App Password named `Epsom website`. Google controls eligibility for App Passwords.
2. Add that password directly in Vercel as a Secret environment variable named `GMAIL_APP_PASSWORD`, scoped to Production. Do not use the normal Google account password or paste either password in chat or source code.
3. Redeploy after changing environment variables. For Preview email tests, explicitly configure the intended private recipient and sending credential in that environment too; otherwise previews save enquiries but leave notifications pending.

Nodemailer is a code library, not another email provider. It sends over TLS directly to Gmail. Notifications go only to the server-configured business address; the customer's email is used as Reply-To. Files are attached as bytes and remain private in Supabase.

## Verification and failure behaviour

Run `npm test` for validation, storage-boundary and notification tests. The readiness endpoint checks the live table and confirms the bucket is private. It does not claim inbox delivery.

Submit a clearly labelled TEST ONLY enquiry on the deployed site, then a second one with a known photo. Confirm both database records and the private object; confirm both notifications and attachment bytes in the business inbox. Test that an anonymous browser cannot retrieve the row or file. A green success message alone is insufficient proof.

Each submission has a stable request ID. Retrying the same request after a timeout reuses its record; changing content requires a new ID. Per-client database throttling limits new records to five per hour. Raw IP addresses are not stored.

If Gmail fails, the saved enquiry remains `notification_status = 'pending'`; no data is discarded. Repeating the same submission retries its notification without creating another record. There is no scheduled background retry in this change. SMTP acceptance is recorded separately from actual inbox delivery. Review pending records after an outage.
