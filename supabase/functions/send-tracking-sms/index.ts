const siteUrl = Deno.env.get('PUBLIC_SITE_URL') || '';
let allowedOrigin = '';
try { allowedOrigin = new URL(siteUrl).origin; } catch {}
const cors = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
  const from = Deno.env.get('TWILIO_PHONE_NUMBER');
  const authorization = request.headers.get('Authorization');
  if (!authorization || !accountSid || !authToken || !from || !allowedOrigin) {
    return Response.json({ error: 'SMS service is not configured.' }, { status: 503, headers: cors });
  }

  try {
    const { job_id, tracking_url } = await request.json();
    const link = new URL(tracking_url);
    if (link.origin !== allowedOrigin || link.pathname !== '/track.html' || !link.searchParams.has('token')) {
      return Response.json({ error: 'Tracking link is invalid.' }, { status: 400, headers: cors });
    }

    const details = await fetch(`${supabaseUrl}/rest/v1/rpc/get_job_tracking_sms_details`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_job_id: job_id })
    });
    if (!details.ok) return Response.json({ error: 'This active job cannot send a tracking message.' }, { status: 403, headers: cors });
    const rows = await details.json();
    const phone = rows?.[0]?.customer_phone;
    if (!phone) return Response.json({ error: 'This job has no active tracking session.' }, { status: 409, headers: cors });

    const form = new URLSearchParams({
      To: phone,
      From: from,
      Body: `Your Epsom locksmith is on the way. Follow their approximate location here (private link expires in 4 hours): ${link.href}`
    });
    const credentials = btoa(`${accountSid}:${authToken}`);
    const sent = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST', headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form
    });
    if (!sent.ok) return Response.json({ error: 'SMS delivery was rejected by the messaging provider.' }, { status: 502, headers: cors });
    return Response.json({ sent: true }, { headers: cors });
  } catch {
    return Response.json({ error: 'Could not send the tracking SMS.' }, { status: 500, headers: cors });
  }
});
