export const config = window.LOCKSMITH_CONFIG || {};
const baseUrl = String(config.supabaseUrl || '').replace(/\/$/, '');

export function backendReady() {
  return Boolean(baseUrl && config.supabaseAnonKey);
}

export function backendMessage() {
  return 'The appointment system is not connected yet. Please check the Supabase URL and public anon key in workflow-config.js.';
}

function headers(token) {
  return {
    apikey: config.supabaseAnonKey || '',
    Authorization: `Bearer ${token || config.supabaseAnonKey || ''}`,
    'Content-Type': 'application/json'
  };
}

export async function rest(path, options = {}, token) {
  if (!backendReady()) throw new Error(backendMessage());
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { ...headers(token), ...options.headers } });
  const body = response.status === 204 ? null : await response.text();
  if (!response.ok) {
    let message = body || `Request failed (${response.status}).`;
    try { const parsed = JSON.parse(body); message = parsed.message || parsed.error || parsed.hint || message; } catch {}
    throw new Error(message);
  }
  if (!body) return null;
  try { return JSON.parse(body); } catch { return body; }
}

export function rpc(name, args = {}, token) {
  return rest(`/rest/v1/rpc/${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(args) }, token);
}

export async function digestHex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function staffToken() { return sessionStorage.getItem('locksmith_staff_token') || ''; }
export function setStaffToken(value) { sessionStorage.setItem('locksmith_staff_token', value); }
export function clearStaffToken() { sessionStorage.removeItem('locksmith_staff_token'); }

export function showMessage(node, message, kind = '') {
  node.textContent = message;
  node.className = `form-message${kind ? ` ${kind}` : ''}`;
}

export function readableTime(value) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
