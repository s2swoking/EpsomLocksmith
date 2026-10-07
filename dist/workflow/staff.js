import { config, backendReady, backendMessage, rest, rpc, digestHex, staffToken, setStaffToken, clearStaffToken, showMessage, readableTime } from './common.js';

const loginPanel = document.getElementById('staff-login');
const dashboard = document.getElementById('staff-dashboard');
const loginMessage = document.getElementById('login-message');
const staffMessage = document.getElementById('staff-message');
const jobList = document.getElementById('job-list');
const emptyJobs = document.getElementById('empty-jobs');
const locationWatches = new Map();

function tokenFromRedirect() {
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get('access_token');
  if (token) { setStaffToken(token); history.replaceState(null, '', location.pathname + location.search); }
  return token || staffToken();
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function setSignedIn(isSignedIn) { loginPanel.hidden = isSignedIn; dashboard.hidden = !isSignedIn; }

async function sendLoginLink(email) {
  const response = await fetch(`${String(config.supabaseUrl).replace(/\/$/, '')}/auth/v1/otp`, {
    method: 'POST', headers: { apikey: config.supabaseAnonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, options: { shouldCreateUser: false, emailRedirectTo: `${location.origin}${location.pathname}` } })
  });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.msg || body.message || 'Could not send the sign-in email.'); }
}

async function loadJobs() {
  if (!staffToken()) return;
  showMessage(staffMessage, 'Loading jobs…');
  try {
    const query = new URLSearchParams({ select: 'id,service,customer_name,customer_phone,address,postcode,notes,appointment_start,appointment_duration_minutes,status,created_at', status: 'in.(pending,accepted,on_way,arrived)', order: 'appointment_start.asc' });
    const jobs = await rest(`/rest/v1/jobs?${query}`, {}, staffToken());
    jobList.innerHTML = jobs.map(jobCard).join('');
    emptyJobs.hidden = jobs.length > 0;
    showMessage(staffMessage, '');
  } catch (error) {
    showMessage(staffMessage, error.message || 'Could not load jobs. Sign in again if your session has expired.', 'error');
    if (error.message.includes('JWT')) { clearStaffToken(); setSignedIn(false); }
  }
}

function jobCard(job) {
  const service = job.service === 'emergency_opening' ? 'Emergency door opening' : 'Lock replacement & repair';
  const status = { pending: 'Awaiting your decision', accepted: 'Accepted', on_way: 'On your way', arrived: 'Arrived' }[job.status] || job.status;
  const start = readableTime(job.appointment_start);
  const buttons = job.status === 'pending' ? '<button class="button button-dark" data-action="accept">Accept</button>'
    : job.status === 'accepted' ? '<button class="button button-lime" data-action="on-way">On my way</button>'
    : job.status === 'on_way' ? '<button class="button button-dark" data-action="arrived">Arrived</button>'
    : '<button class="button button-dark" data-action="complete">Complete</button>';
  const cachedLink = sessionStorage.getItem(`tracking_link_${job.id}`);
  const retry = job.status === 'on_way' && cachedLink ? '<button class="button button-light" data-action="resend">Resend tracking SMS</button>' : '';
  return `<article class="job-card" data-job-id="${escapeHTML(job.id)}"><div class="job-card-heading"><span class="job-status">${escapeHTML(status)}</span><time>${escapeHTML(start)}</time></div><h2>${escapeHTML(service)}</h2><p class="job-customer"><strong>${escapeHTML(job.customer_name)}</strong> · <a href="tel:${escapeHTML(job.customer_phone.replace(/[^+\d]/g, ''))}">${escapeHTML(job.customer_phone)}</a></p><p>${escapeHTML(job.address)}<br>${escapeHTML(job.postcode)}</p>${job.notes ? `<p class="job-notes">${escapeHTML(job.notes)}</p>` : ''}<div class="job-card-actions">${buttons}${retry}</div></article>`;
}

async function startLocationWatch(jobId) {
  if (!navigator.geolocation) return;
  const previous = locationWatches.get(jobId);
  if (previous) navigator.geolocation.clearWatch(previous.watchId);
  let lastSent = 0;
  const watchId = navigator.geolocation.watchPosition(async position => {
    if (Date.now() - lastSent < 10000) return;
    lastSent = Date.now();
    try {
      await rpc('record_job_location', { p_job_id: jobId, p_latitude: position.coords.latitude, p_longitude: position.coords.longitude, p_accuracy_m: Math.round(position.coords.accuracy) }, staffToken());
    } catch (error) { showMessage(staffMessage, `Location update paused: ${error.message}`, 'error'); }
  }, error => showMessage(staffMessage, `Location sharing is unavailable: ${error.message}. The customer has received the tracking link.`, 'error'), { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
  locationWatches.set(jobId, { watchId });
}

async function startJobTracking(job) {
  const rawToken = crypto.randomUUID() + crypto.randomUUID();
  const tokenHash = await digestHex(rawToken);
  const trackingUrl = new URL('./track.html', location.href);
  trackingUrl.searchParams.set('token', rawToken);
  await rpc('start_job_tracking', { p_job_id: job.id, p_token_hash: tokenHash }, staffToken());
  sessionStorage.setItem(`tracking_link_${job.id}`, trackingUrl.href);
  await startLocationWatch(job.id);
  await sendTrackingSms(job, trackingUrl.href);
}

async function sendTrackingSms(job, trackingUrl) {
  const result = await rest('/functions/v1/send-tracking-sms', { method: 'POST', body: JSON.stringify({ job_id: job.id, phone: job.customer_phone, tracking_url: trackingUrl }) }, staffToken());
  return result;
}

document.getElementById('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    if (!backendReady()) throw new Error(backendMessage());
    await sendLoginLink(new FormData(event.currentTarget).get('email').trim());
    showMessage(loginMessage, 'Check your inbox for the secure sign-in link.');
  } catch (error) { showMessage(loginMessage, error.message, 'error'); }
  finally { button.disabled = false; }
});

document.getElementById('refresh-jobs').addEventListener('click', loadJobs);
document.getElementById('sign-out').addEventListener('click', () => { for (const { watchId } of locationWatches.values()) navigator.geolocation?.clearWatch(watchId); locationWatches.clear(); clearStaffToken(); setSignedIn(false); });

jobList.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  const card = event.target.closest('[data-job-id]');
  if (!button || !card) return;
  const action = button.dataset.action;
  const jobId = card.dataset.jobId;
  const job = { id: jobId, customer_phone: card.querySelector('a[href^="tel:"]')?.textContent || '' };
  button.disabled = true;
  try {
    if (action === 'accept') await rpc('accept_job', { p_job_id: jobId }, staffToken());
    else if (action === 'on-way') {
      const query = new URLSearchParams({ select: 'id,customer_phone', id: `eq.${jobId}`, limit: '1' });
      job.customer_phone = (await rest(`/rest/v1/jobs?${query}`, {}, staffToken()))[0].customer_phone;
      const fullJob = { ...job, ...{ id: jobId } };
      await startJobTracking(fullJob);
      showMessage(staffMessage, 'Tracking has started and the customer SMS was sent.', 'success');
    } else if (action === 'arrived' || action === 'complete') {
      const { watchId } = locationWatches.get(jobId) || {};
      if (watchId !== undefined) navigator.geolocation?.clearWatch(watchId);
      locationWatches.delete(jobId);
      await rpc('advance_job', { p_job_id: jobId, p_new_status: action }, staffToken());
    } else if (action === 'resend') {
      await sendTrackingSms(job, sessionStorage.getItem(`tracking_link_${jobId}`));
      showMessage(staffMessage, 'Tracking SMS sent again.', 'success');
    }
    await loadJobs();
  } catch (error) {
    showMessage(staffMessage, error.message || 'That action could not be completed.', 'error');
    if (action === 'on-way') await loadJobs();
    button.disabled = false;
  }
});

setInterval(() => { if (!dashboard.hidden && staffToken()) loadJobs(); }, 60000);

const token = tokenFromRedirect();
if (backendReady() && token) {
  rest('/auth/v1/user', {}, token).then(() => { setSignedIn(true); loadJobs(); }).catch(() => { clearStaffToken(); setSignedIn(false); });
} else if (!backendReady()) showMessage(loginMessage, backendMessage(), 'error');
