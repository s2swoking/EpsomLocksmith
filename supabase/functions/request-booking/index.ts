const siteUrl = Deno.env.get('PUBLIC_SITE_URL') || '';
let allowedOrigin = '';
try { allowedOrigin = new URL(siteUrl).origin; } catch {}
const cors = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

async function hashClient(ip: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const result = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip)));
  return [...result].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors });
  const origin = request.headers.get('Origin');
  if (!allowedOrigin || (origin && origin !== allowedOrigin)) return Response.json({ error: 'Request origin is not allowed.' }, { status: 403, headers: cors });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const rateSalt = Deno.env.get('BOOKING_RATE_LIMIT_SALT');
  if (!serviceKey || !rateSalt) return Response.json({ error: 'Booking service is not configured.' }, { status: 503, headers: cors });

  try {
    const body = await request.json();
    const forwarded = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (!forwarded) return Response.json({ error: 'Could not validate this request. Please call the locksmith.' }, { status: 400, headers: cors });
    const result = await fetch(`${supabaseUrl}/rest/v1/rpc/create_booking_request`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_ip_hash: await hashClient(forwarded, rateSalt),
        p_service: body.service,
        p_customer_name: body.customer_name,
        p_customer_phone: body.customer_phone,
        p_address: body.address,
        p_postcode: body.postcode,
        p_notes: body.notes || null,
        p_appointment_start: body.appointment_start,
        p_appointment_duration_minutes: body.appointment_duration_minutes
      })
    });
    if (!result.ok) {
      const detail = await result.json().catch(() => ({}));
      const status = result.status === 429 || detail.message?.includes('Too many requests') ? 429 : 400;
      return Response.json({ error: detail.message || 'Booking request could not be saved.' }, { status, headers: cors });
    }
    return Response.json({ received: true }, { headers: cors });
  } catch {
    return Response.json({ error: 'Booking request could not be sent. Please try again or call the locksmith.' }, { status: 400, headers: cors });
  }
});
