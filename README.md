# EpsomLocksmith

Local locksmith website for Epsom, Ewell West and Worcester Park.

## Website

The complete website is in `dist/`. It is static HTML, CSS and JavaScript and needs no installation or build step. Open `dist/index.html` or serve `dist/` with a local HTTP server.

The hero uses a softly blurred door photograph, a brass lock with gentle continuous and scroll motion, and a smaller, slower animation for reduced-motion preferences.

## Deploy On Vercel

Connect this GitHub repository to Vercel. Select the **Other** framework, keep the repository root as the root directory, and set the output directory to `dist`. Build and install commands are empty; `vercel.json` contains these settings.

## Appointment Screens

The customer request form is on the home page at `/#booking`. The private locksmith screen is `/staff.html`, and customer tracking is `/track.html`. Backend schema and Edge Functions are in `supabase/`; setup steps are in `BACKEND-SETUP.md`.

Set the Supabase project URL and public anon key in `dist/workflow-config.js` before enabling live booking requests. Keep service-role and messaging credentials in Supabase secrets, never in `dist/`.

## Business Details

The name Epsom Local Locksmith is provisional. Confirm the name and phone number in `dist/app.js` before using the site for customer calls. A blank phone number intentionally leaves calling unavailable. Update the HTML title and metadata if the business name changes.

The two service guide prices are £89 for emergency door opening and from £65 for lock replacement and repair. Both may change for more extensive work required on site.
