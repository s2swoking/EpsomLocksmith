import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GET, POST } from '../api/contact.mjs';

const originalFetch = globalThis.fetch;
const originalRecipient = process.env.CONTACT_TO_EMAIL;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalRecipient === undefined) delete process.env.CONTACT_TO_EMAIL;
  else process.env.CONTACT_TO_EMAIL = originalRecipient;
});
function form(changes = {}) {
  const data = new FormData();
  const values = { name: 'Website test', phone: '00000000000', email: 'test@example.com', postcode: 'kt17 1aa', service: 'Lock replacement or repair', message: 'TEST ONLY. No visit required.', ...changes };
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
}
function request(data, origin = 'https://epsomlocksmith.vercel.app') {
  process.env.CONTACT_TO_EMAIL = 'private-recipient@example.com';
  return new Request('https://epsomlocksmith.vercel.app/api/contact', { method: 'POST', headers: { Origin: origin }, body: data });
}
test('configuration health never reveals the recipient', async () => {
  delete process.env.CONTACT_TO_EMAIL;
  assert.equal(GET().status, 503);
  process.env.CONTACT_TO_EMAIL = 'private-recipient@example.com';
  assert.deepEqual(await GET().json(), { ready: true, maxFileBytes: 3000000 });
});
test('rejects cross-site submission before contacting the provider', async () => {
  globalThis.fetch = () => { throw new Error('Must not send'); };
  assert.equal((await POST(request(form(), 'https://unrelated.example'))).status, 403);
});
test('rejects incomplete fields and malformed email', async () => {
  assert.equal((await POST(request(form({ name: '   ' })))).status, 400);
  assert.equal((await POST(request(form({ email: 'invalid-address' })))).status, 400);
});
test('rejects unknown services and filled honeypot', async () => {
  assert.equal((await POST(request(form({ service: 'Other invented service' })))).status, 400);
  assert.equal((await POST(request(form({ website: 'spam' })))).status, 400);
});
test('forwards the fixed private recipient and submitted details', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://formsubmit.co/ajax/private-recipient%40example.com');
    assert.equal(options.body.get('email'), 'test@example.com');
    assert.equal(options.body.get('postcode'), 'KT17 1AA');
    assert.equal(options.body.get('_subject'), 'New website enquiry: Lock replacement or repair');
    assert.equal(options.body.get('_cc'), null);
    return Response.json({ success: 'true' });
  };
  const response = await POST(request(form({ _cc: 'someone-else@example.com' })));
  assert.deepEqual(await response.json(), { sent: true });
});
test('preserves photo bytes and attachment name', async () => {
  const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
  const data = form();
  data.set('attachment', new Blob([png], { type: 'image/png' }), 'lock-photo.png');
  globalThis.fetch = async (url, options) => {
    const uploaded = options.body.get('attachment');
    assert.equal(uploaded.name, 'lock-photo.png');
    assert.deepEqual(new Uint8Array(await uploaded.arrayBuffer()), png);
    return Response.json({ success: true });
  };
  assert.equal((await POST(request(data))).status, 200);
});
test('preserves MP4 bytes when forwarding a short video', async () => {
  const video = new Uint8Array([0,0,0,16,102,116,121,112,105,115,111,109]);
  const data = form();
  data.set('attachment', new Blob([video], { type: 'video/mp4' }), 'lock-video.mp4');
  globalThis.fetch = async (url, options) => {
    assert.equal(options.body.get('attachment').type, 'video/mp4');
    assert.deepEqual(new Uint8Array(await options.body.get('attachment').arrayBuffer()), video);
    return Response.json({ success: true });
  };
  assert.equal((await POST(request(data))).status, 200);
});
test('rejects oversized attachments', async () => {
  const data = form();
  data.set('attachment', new Blob([new Uint8Array(3000001)], { type: 'image/png' }), 'large.png');
  assert.equal((await POST(request(data))).status, 413);
});
test('rejects unsupported file types and disguised file contents', async () => {
  for (const [contents, type, filename] of [['bad', 'text/plain', 'notes.txt'], ['not a photo', 'image/png', 'fake.png']]) {
    const data = form();
    data.set('attachment', new Blob([contents], { type }), filename);
    assert.equal((await POST(request(data))).status, 400);
  }
});
test('does not report success or leak destination when provider rejects a submission', async () => {
  globalThis.fetch = async () => Response.json({ success: false, message: 'Private recipient is private-recipient@example.com' });
  const response = await POST(request(form()));
  assert.equal(response.status, 502);
  assert.equal((await response.text()).includes('private-recipient@example.com'), false);
});
