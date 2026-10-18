const MAX_FILE_BYTES = 3_000_000;
const MAX_REQUEST_BYTES = 3_100_000;
const PHONE = '020 4505 8291';
// Keep FormSubmit's activated form identity at the canonical website root.
// website_url below records the actual page used for each enquiry.
const PROVIDER_FORM_URL = 'https://epsomlocksmiths.co.uk/';
const SERVICES = new Set([
  'Lock replacement or repair',
  'Car locks or replacement keys',
  'Boarding up or burglary repairs',
  'Window locks, handles or mechanisms',
  'Moving-home lock changes',
  'Safe opening or repair',
  'Door repairs or replacement',
  'Gate welding or repairs',
  'Something else / not sure',
]);
const ORIGINS = new Set([
  'https://epsomlocksmith.vercel.app',
  'https://epsomlocksmiths.co.uk',
  'https://www.epsomlocksmiths.co.uk',
]);
const FILE_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  mp4: 'video/mp4', mov: 'video/quicktime',
};
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function json(status, data) {
  return Response.json(data, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  } });
}
function configuredRecipient() {
  const recipient = process.env.CONTACT_TO_EMAIL?.trim();
  return recipient && EMAIL.test(recipient) ? recipient : null;
}
function acceptedOrigin(origin) {
  if (ORIGINS.has(origin)) return true;
  return Boolean(process.env.VERCEL_URL && origin === 'https://' + process.env.VERCEL_URL);
}
function validSignature(bytes, extension) {
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  if (extension === 'jpg' || extension === 'jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (extension === 'png') return bytes[0] === 137 && ascii(1, 4) === 'PNG' && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
  if (extension === 'webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  return bytes.length >= 12 && ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].includes(ascii(4, 8));
}

export function GET() {
  const ready = Boolean(configuredRecipient());
  return json(ready ? 200 : 503, { ready, maxFileBytes: MAX_FILE_BYTES });
}

export async function POST(request) {
  const origin = request.headers.get('origin');
  if (!acceptedOrigin(origin)) return json(403, { error: 'Please send your enquiry from our website.' });
  const recipient = configuredRecipient();
  if (!recipient) return json(503, { error: 'Online enquiries are temporarily unavailable. Please call ' + PHONE + '.' });
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) return json(415, { error: 'Please use the website enquiry form.' });
  if (Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES) return json(413, { error: 'Please choose an attachment no larger than 3 MB.' });

  let data;
  try {
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_REQUEST_BYTES) return json(413, { error: 'Please choose an attachment no larger than 3 MB.' });
    data = await new Response(body, { headers: { 'Content-Type': contentType } }).formData();
  } catch {
    return json(400, { error: 'The form could not be read. Please try again.' });
  }
  if (data.get('website')) return json(400, { error: 'The enquiry could not be sent. Please call ' + PHONE + '.' });
  const fields = {};
  for (const [key, limit] of Object.entries({ name: 100, phone: 40, email: 254, postcode: 12, service: 100, message: 3000 })) {
    const raw = data.get(key);
    if (typeof raw !== 'string' || !raw.trim() || raw.length > limit) return json(400, { error: 'Please complete all required fields within the displayed limits.' });
    fields[key] = raw.trim().replace(/\0/g, '');
    if (key !== 'message') fields[key] = fields[key].replace(/[\r\n]/g, ' ');
    if (!fields[key].trim()) return json(400, { error: 'Please complete all required fields.' });
  }
  if (!EMAIL.test(fields.email)) return json(400, { error: 'Please enter a valid email address.' });
  if (!SERVICES.has(fields.service)) return json(400, { error: 'Please choose one of the listed services.' });
  fields.postcode = fields.postcode.toUpperCase();

  const outgoing = new FormData();
  for (const [key, value] of Object.entries(fields)) outgoing.set(key, value);
  const attachment = data.get('attachment');
  if (attachment && typeof attachment !== 'string' && (attachment.name || attachment.size)) {
    if (!attachment.size) return json(400, { error: 'The attachment is empty. Please choose another file.' });
    if (attachment.size > MAX_FILE_BYTES) return json(413, { error: 'Please choose an attachment no larger than 3 MB.' });
    const extension = attachment.name.split('.').pop()?.toLowerCase();
    const type = FILE_TYPES[extension];
    if (!type || (attachment.type && attachment.type !== type)) return json(400, { error: 'Choose a JPG, PNG, WebP, MP4 or MOV file.' });
    const bytes = new Uint8Array(await attachment.arrayBuffer());
    if (!validSignature(bytes, extension)) return json(400, { error: 'This attachment does not match its file type. Please choose another file.' });
    const filename = attachment.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
    outgoing.set('attachment', new Blob([bytes], { type }), filename);
  } else if (typeof attachment === 'string' && attachment) {
    return json(400, { error: 'Please choose an attachment using the file picker.' });
  }
  outgoing.set('_subject', 'New website enquiry: ' + fields.service);
  outgoing.set('_template', 'table');
  outgoing.set('_url', PROVIDER_FORM_URL);
  outgoing.set('website_url', origin + '/#enquiry');

  try {
    const response = await fetch('https://formsubmit.co/ajax/' + encodeURIComponent(recipient), {
      method: 'POST', headers: { Accept: 'application/json', Origin: new URL(PROVIDER_FORM_URL).origin, Referer: PROVIDER_FORM_URL },
      body: outgoing, signal: AbortSignal.timeout(20_000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || (result?.success !== true && result?.success !== 'true')) {
      // Never log the destination address, form content, or provider response.
      const message = typeof result?.message === 'string' ? result.message.toLowerCase() : '';
      const code = !response.ok ? 'PROVIDER_HTTP_' + response.status
        : !result ? 'PROVIDER_INVALID_RESPONSE'
        : message.includes('activat') ? 'ACTIVATION_REQUIRED'
        : message.includes('formatted correctly') ? 'RECIPIENT_REJECTED'
        : message.includes('web server') ? 'PROVIDER_ORIGIN_REJECTED' : 'PROVIDER_REJECTED';
      console.error('Contact email provider rejected submission', { status: response.status, code });
      return json(502, { error: 'We could not confirm your enquiry was sent. Please call ' + PHONE + ' before trying again.', code });
    }
    return json(200, { sent: true });
  } catch {
    console.error('Contact email provider request failed');
    return json(502, { error: 'We could not confirm your enquiry was sent. Please call ' + PHONE + ' before trying again.' });
  }
}
