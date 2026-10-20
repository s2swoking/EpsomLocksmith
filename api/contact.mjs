import { createHash, createHmac } from 'node:crypto';
import { BUCKET, database, databaseConfiguration, rpc, storageReady, updateEnquiry } from '../lib/enquiry-store.mjs';
import { gmailConfiguration, notifyEnquiry } from '../lib/enquiry-mail.mjs';

const MAX_FILE_BYTES = 3_000_000;
const MAX_REQUEST_BYTES = 3_100_000;
const PHONE = '0203 7720564';
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

export async function GET() {
  const config = databaseConfiguration();
  let ready = false;
  if (config) {
    try { ready = await storageReady(config); } catch {}
  }
  return json(ready ? 200 : 503, { ready, maxFileBytes: MAX_FILE_BYTES });
}

export async function POST(request) {
  const origin = request.headers.get('origin');
  if (!acceptedOrigin(origin)) return json(403, { error: 'Please send your enquiry from our website.' });
  const config = databaseConfiguration();
  if (!config) return json(503, { error: 'Online enquiries are temporarily unavailable. Please call ' + PHONE + '.' });
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
  const requestId = data.get('requestId');
  if (typeof requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId)) return json(400, { error: 'Please refresh the page and try again.' });
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

  let upload = null;
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
    upload = { bytes, type, name: filename, path: requestId + '/' + filename, size: attachment.size };
  } else if (typeof attachment === 'string' && attachment) {
    return json(400, { error: 'Please choose an attachment using the file picker.' });
  }

  const digest = createHash('sha256').update(JSON.stringify(fields));
  if (upload) digest.update(upload.name).update(upload.type).update(upload.bytes);
  const requestHash = digest.digest('hex');
  const ip = request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (!ip) return json(400, { error: 'Please send your enquiry from our website.' });
  const clientHash = createHmac('sha256', config.key).update(ip).digest('hex');
  try {
    const record = await rpc(config, 'reserve_website_enquiry', {
      p_id: requestId, p_hash: requestHash, p_client_hash: clientHash, p_fields: fields,
      p_attachment: upload ? { path: upload.path, name: upload.name, type: upload.type, size: upload.size } : null,
    });
    if (record.error === 'RATE_LIMIT') return json(429, { error: 'Please call ' + PHONE + ' if you need further help with your enquiry.' });
    if (record.error === 'ID_CONFLICT') return json(409, { error: 'Your enquiry details changed. Please try sending again.', code: 'ID_CONFLICT' });
    if (record.id !== requestId) throw new Error('ENQUIRY_NOT_SAVED');
    if (upload && !record.attachment_ready) {
      await database(config, '/storage/v1/object/' + BUCKET + '/' + upload.path.split('/').map(encodeURIComponent).join('/'), {
        method: 'POST', headers: { 'Content-Type': upload.type, 'x-upsert': 'true' }, body: upload.bytes,
      });
      await updateEnquiry(config, requestId, { attachment_ready: true });
    }
    const notification = record.notification_status === 'sent' ? 'sent' : await notifyEnquiry(config, requestId, gmailConfiguration());
    return json(200, { sent: true, reference: requestId, notification });
  } catch {
    console.error('Enquiry could not be confirmed', { reference: requestId });
    return json(502, { error: 'We could not confirm receipt. Your details are still here. Please try again or call ' + PHONE + '.', code: 'SAVE_UNCONFIRMED' });
  }
}

