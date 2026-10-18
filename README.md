# EpsomLocksmith

Local locksmith website for Epsom, Ewell West and Worcester Park.

## Website

The website frontend is in `dist/`. It is static HTML, CSS and JavaScript and needs no installation or build step. Online enquiries use the Vercel Function in `api/contact.mjs`.

The hero uses a softly blurred door photograph, a brass lock with gentle continuous and scroll motion, and a smaller, slower animation for reduced-motion preferences.

## Deploy On Vercel

Connect this GitHub repository to Vercel. Select the **Other** framework, keep the repository root as the root directory, and set the output directory to `dist`. Build and install commands are empty; `vercel.json` contains these settings.

## Appointment Screens

The public home page is call-first. The private appointment manager is `/staff.html`: after a call, sign in and add the confirmed job there. The customer tracking page is `/track.html`. Backend schema and Edge Functions are in `supabase/`; setup steps are in `BACKEND-SETUP.md`.

Set the Supabase project URL and public anon key in `dist/workflow-config.js` to enable staff sign-in and appointment management. Keep service-role and messaging credentials in Supabase secrets, never in `dist/`.

## Business Details

The name Epsom Local Locksmith is provisional. Confirm the name and phone number in `dist/app.js` before using the site for customer calls. A blank phone number intentionally leaves calling unavailable. Update the HTML title and metadata if the business name changes.

The two service guide prices are £89 for emergency door opening and from £65 for lock replacement and repair. Both may change for more extensive work required on site.

## Private contact-form delivery

Set `CONTACT_TO_EMAIL` as a server-only Secret environment variable in the Vercel project's Production environment, then redeploy. Keep the recipient address out of `dist/`, source code and logs. The form uses the same-origin `/api/contact` endpoint; only the server forwards enquiries to FormSubmit. FormSubmit must be activated for the receiving address. The handler uses the activated canonical form URL, https://epsomlocksmiths.co.uk/, consistently across website aliases; the actual enquiry page is included as a separate metadata field. `GET /api/contact` reports configuration readiness without exposing that address.

Enquiries require a name, phone, email, postcode, service and message. One optional JPG, PNG, WebP, MP4 or MOV attachment is supported, up to **3 MB** to stay within Vercel's request limit. The handler validates allowed origins, required fields, attachment type and size, and a honeypot. It returns success only when the email provider accepts the submission; actual inbox delivery should also be verified with a clearly labelled test after a new domain is connected.

Run the handler's validation and forwarding tests with `node --test tests/contact.test.mjs`. No dependencies or build step are required.
