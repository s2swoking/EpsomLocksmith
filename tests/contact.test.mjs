import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GET, POST } from '../api/contact.mjs';
import { sendGmailNotification, gmailConfiguration, notifyEnquiry } from '../lib/enquiry-mail.mjs';

const savedFetch = globalThis.fetch;
const envNames = ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','CONTACT_TO_EMAIL','GMAIL_APP_PASSWORD'];
const savedEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
const ID = 'e13799c6-9372-45f5-9ac2-d88f278eb231';
const config = { url: 'https://example.supabase.co', key: 'server-secret-test-only' };
afterEach(() => {
  globalThis.fetch = savedFetch;
  envNames.forEach(name => savedEnv[name] === undefined ? delete process.env[name] : process.env[name] = savedEnv[name]);
});
function configure() {
  process.env.SUPABASE_URL = config.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = config.key;
  delete process.env.GMAIL_APP_PASSWORD;
  process.env.CONTACT_TO_EMAIL = 'private-business@gmail.com';
}
function form(changes = {}) {
  const data = new FormData();
  const fields = { requestId: ID, name: 'WEBSITE TEST', phone: '00000000000', email: 'test@example.com', postcode: 'kt17 1aa', service: 'Lock replacement or repair', message: 'TEST ONLY. No visit or callback required.', ...changes };
  Object.entries(fields).forEach(([key,value]) => data.set(key,value));
  return data;
}
function request(data = form(), origin = 'https://epsomlocksmiths.co.uk') {
  configure();
  return new Request(origin + '/api/contact', { method: 'POST', headers: { Origin: origin, 'x-forwarded-for': '192.0.2.1' }, body: data });
}
test('health checks real table and private bucket, without exposing credentials', async () => {
  configure();
  globalThis.fetch = async url => url.includes('/bucket/') ? Response.json({ id: 'website-enquiries', public: false }) : Response.json([]);
  assert.deepEqual(await (await GET()).json(), { ready: true, maxFileBytes: 3000000 });
  globalThis.fetch = async () => Response.json({ public: true });
  assert.equal((await GET()).status, 503);
});
test('rejects unknown origins, missing fields and honeypots before saving', async () => {
  globalThis.fetch = () => { throw new Error('Unexpected database access'); };
  assert.equal((await POST(request(form(), 'https://unrelated.example'))).status, 403);
  assert.equal((await POST(request(form({ name: '' })))).status, 400);
  assert.equal((await POST(request(form({ website: 'spam' })))).status, 400);
  assert.equal((await POST(request(form({ requestId: 'not-a-uuid' })))).status, 400);
});
test('saves an enquiry even when no Gmail credential is configured', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, config.url + '/rest/v1/rpc/reserve_website_enquiry');
    const body = JSON.parse(options.body);
    assert.equal(body.p_fields.postcode, 'KT17 1AA');
    assert.equal(body.p_fields.email, 'test@example.com');
    assert.equal(body.p_id, ID);
    assert.match(body.p_client_hash, /^[a-f0-9]{64}$/);
    assert.equal(options.headers.apikey, config.key);
    assert.equal(JSON.stringify(body).includes('192.0.2.1'), false);
    return Response.json({ id: ID, attachment_ready: true, notification_status: 'pending' });
  };
  const result = await POST(request());
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { sent: true, reference: ID, notification: 'pending' });
});
test('never reports receipt when database rejects the save', async () => {
  globalThis.fetch = async () => new Response('secret provider detail', { status: 500 });
  const response = await POST(request());
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.equal(text.includes('secret provider detail'), false);
  assert.equal(text.includes(config.key), false);
});
test('reports a database rate limit and idempotency conflict correctly', async () => {
  globalThis.fetch = async () => Response.json({ error: 'RATE_LIMIT' });
  assert.equal((await POST(request())).status, 429);
  globalThis.fetch = async () => Response.json({ error: 'ID_CONFLICT' });
  assert.equal((await POST(request())).status, 409);
});
test('saves photo bytes in private storage and marks ready only after upload succeeds', async () => {
  const bytes = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
  const data = form(); data.set('attachment', new Blob([bytes], { type: 'image/png' }), 'lock.png');
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    if (url.endsWith('reserve_website_enquiry')) return Response.json({ id: ID, attachment_ready: false, notification_status: 'pending' });
    if (url.includes('/storage/')) {
      assert.equal(url, config.url + '/storage/v1/object/website-enquiries/' + ID + '/lock.png');
      assert.deepEqual(options.body, bytes);
      return Response.json({ Key: 'saved' });
    }
    assert.deepEqual(JSON.parse(options.body), { attachment_ready: true });
    return new Response(null, { status: 204 });
  };
  assert.equal((await POST(request(data))).status, 200);
  assert.equal(calls.length, 3);
});
test('keeps the saved record retryable if attachment upload fails', async () => {
  const data = form(); data.set('attachment', new Blob([new Uint8Array([255,216,255,0])], { type: 'image/jpeg' }), 'lock.jpg');
  let reserved = false;
  globalThis.fetch = async url => {
    if (url.endsWith('reserve_website_enquiry')) { reserved = true; return Response.json({ id: ID, attachment_ready: false }); }
    return new Response('upload failed', { status: 503 });
  };
  assert.equal((await POST(request(data))).status, 502);
  assert.equal(reserved, true);
});
test('rejects oversized and disguised attachments before any database write', async () => {
  globalThis.fetch = () => { throw new Error('Must not save'); };
  const large = form(); large.set('attachment', new Blob([new Uint8Array(3000001)], { type: 'image/png' }), 'large.png');
  assert.equal((await POST(request(large))).status, 413);
  const fake = form(); fake.set('attachment', new Blob(['not an image'], { type: 'image/png' }), 'fake.png');
  assert.equal((await POST(request(fake))).status, 400);
});
test('Gmail transport fixes sender/recipient to server settings and preserves attachment bytes', async () => {
  const mail = { user: 'private-business@gmail.com', pass: 'abcdefghijklmnop' };
  const bytes = Buffer.from('test attachment');
  let closed = false;
  const id = await sendGmailNotification(mail, { id: ID, name: 'Test', phone: '000', email: 'customer@example.com', postcode: 'KT17', service: 'Lock repair', message: 'TEST ONLY', to: 'attacker@example.com', attachment_name: 'photo.png', attachment_type: 'image/png', attachment: bytes }, options => {
    assert.equal(options.host, 'smtp.gmail.com'); assert.equal(options.secure, true);
    assert.equal(options.disableUrlAccess, true); assert.equal(options.disableFileAccess, true);
    return { sendMail: async message => {
      assert.equal(message.to, mail.user); assert.equal(message.from.address, mail.user);
      assert.equal(message.replyTo, 'customer@example.com');
      assert.deepEqual(message.attachments[0].content, bytes);
      return { accepted: [mail.user], messageId: 'test-message' };
    }, close: () => { closed = true; } };
  });
  assert.equal(id, 'test-message'); assert.equal(closed, true);
});
test('Gmail rejection never counts as sent', async () => {
  await assert.rejects(sendGmailNotification({ user: 'private-business@gmail.com', pass: 'abcdefghijklmnop' }, { id: ID, email: 'test@example.com' }, () => ({ sendMail: async () => ({ accepted: [] }) })), /GMAIL_REJECTED/);
  assert.equal(gmailConfiguration({ CONTACT_TO_EMAIL: 'private-business@gmail.com', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop' }).pass, 'abcdefghijklmnop');
});
test('Gmail failure leaves a saved enquiry pending for retry', async () => {
  const patches = [];
  globalThis.fetch = async (url, options) => {
    if (url.includes('claim_website_notification')) return Response.json(true);
    if (options.method === 'PATCH') { patches.push(JSON.parse(options.body)); return new Response(null, { status: 204 }); }
    return Response.json([{ id: ID, attachment_ready: true, email: 'test@example.com' }]);
  };
  assert.equal(await notifyEnquiry(config, ID, { user: 'private-business@gmail.com', pass: 'abcdefghijklmnop' }, async () => { throw new Error('Gmail unavailable'); }), 'pending');
  assert.deepEqual(patches, [{ notification_status: 'pending' }]);
});
