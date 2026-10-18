import { BUCKET, database, rpc, updateEnquiry } from './enquiry-store.mjs';
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export function gmailConfiguration(env = process.env) {
  const user = env.CONTACT_TO_EMAIL?.trim();
  const pass = env.GMAIL_APP_PASSWORD?.replace(/\s/g, '');
  if (!user || !EMAIL.test(user) || !user.toLowerCase().endsWith('@gmail.com') || !/^[a-z]{16}$/i.test(pass || '')) return null;
  return { user, pass };
}
export async function sendGmailNotification(config, row, createTransport) {
  if (!createTransport) {
    const { default: nodemailer } = await import('nodemailer');
    createTransport = nodemailer.createTransport;
  }
  const transport = createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 7_000, greetingTimeout: 7_000, socketTimeout: 10_000,
    disableFileAccess: true, disableUrlAccess: true, tls: { minVersion: 'TLSv1.2' },
  });
  const message = {
    from: { name: 'Epsom Local Locksmith website', address: config.user },
    to: config.user, replyTo: row.email,
    subject: 'Website enquiry: ' + row.service,
    messageId: '<enquiry-' + row.id + '@epsomlocksmiths.co.uk>',
    text: ['New website enquiry', 'Reference: ' + row.id, '', 'Name: ' + row.name, 'Phone: ' + row.phone, 'Email: ' + row.email, 'Postcode: ' + row.postcode, 'Service: ' + row.service, '', row.message, '', row.attachment_name ? 'Attachment: ' + row.attachment_name : 'No attachment supplied.'].join('\n'),
    attachments: row.attachment ? [{ filename: row.attachment_name, contentType: row.attachment_type, content: row.attachment }] : [],
  };
  try {
    const result = await transport.sendMail(message);
    const accepted = result.accepted?.some(address => String(typeof address === 'string' ? address : address.address).toLowerCase() === config.user.toLowerCase());
    if (!accepted) throw new Error('GMAIL_REJECTED');
    return result.messageId;
  } finally { transport.close?.(); }
}
export async function notifyEnquiry(config, id, mailConfig, send = sendGmailNotification) {
  if (!mailConfig) return 'pending';
  if (await rpc(config, 'claim_website_notification', { p_id: id }) !== true) return 'pending';
  try {
    const rows = await database(config, '/rest/v1/website_enquiries?id=eq.' + id + '&select=*').then(response => response.json());
    const row = rows[0];
    if (!row || !row.attachment_ready) throw new Error('ENQUIRY_NOT_READY');
    if (row.attachment_path) {
      const file = await database(config, '/storage/v1/object/authenticated/' + BUCKET + '/' + row.attachment_path.split('/').map(encodeURIComponent).join('/'));
      row.attachment = Buffer.from(await file.arrayBuffer());
    }
    const messageId = await send(mailConfig, row);
    await updateEnquiry(config, id, { notification_status: 'sent', notified_at: new Date().toISOString(), notification_message_id: messageId });
    return 'sent';
  } catch {
    await updateEnquiry(config, id, { notification_status: 'pending' }).catch(() => {});
    console.error('Enquiry notification pending', { reference: id });
    return 'pending';
  }
}
