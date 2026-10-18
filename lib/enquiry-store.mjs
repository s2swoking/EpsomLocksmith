export const BUCKET = 'website-enquiries';
export function databaseConfiguration(env = process.env) {
  const url = env.SUPABASE_URL?.trim().replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url || '') || !key) return null;
  return { url, key };
}
export async function database(config, path, options = {}) {
  const response = await fetch(config.url + path, {
    ...options,
    headers: { apikey: config.key, Authorization: 'Bearer ' + config.key, ...options.headers },
    signal: AbortSignal.timeout(8_000), cache: 'no-store',
  });
  if (!response.ok) throw new Error('DATABASE_REQUEST_FAILED');
  return response;
}
export async function rpc(config, name, data) {
  const response = await database(config, '/rest/v1/rpc/' + name, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  return response.json();
}
export async function updateEnquiry(config, id, values) {
  await database(config, '/rest/v1/website_enquiries?id=eq.' + id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(values),
  });
}
export async function storageReady(config) {
  const [rows, bucket] = await Promise.all([
    database(config, '/rest/v1/website_enquiries?select=id&limit=0'),
    database(config, '/storage/v1/bucket/' + BUCKET).then(response => response.json()),
  ]);
  return rows.ok && bucket.id === BUCKET && bucket.public === false;
}
