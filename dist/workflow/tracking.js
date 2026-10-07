import { backendReady, backendMessage, rpc, digestHex } from './common.js';

const title = document.getElementById('tracking-title');
const copy = document.getElementById('tracking-copy');
const locationBox = document.getElementById('tracking-location');
const updated = document.getElementById('tracking-updated');
const rawToken = new URLSearchParams(location.search).get('token');
let timer;

function message(heading, text) { title.textContent = heading; copy.textContent = text; locationBox.hidden = true; updated.textContent = ''; }

async function refresh() {
  try {
    const tokenHash = await digestHex(rawToken);
    const rows = await rpc('get_public_tracking', { p_token_hash: tokenHash });
    const session = Array.isArray(rows) ? rows[0] : rows;
    if (!session) { message('This tracking link has expired.', 'Please contact the locksmith if you need an update.'); clearInterval(timer); return; }
    if (session.status === 'arrived') { message('Your locksmith has arrived.', 'Location sharing has stopped.'); clearInterval(timer); return; }
    if (session.status === 'complete') { message('This visit is complete.', 'Location sharing has stopped.'); clearInterval(timer); return; }
    if (session.status !== 'on_way') { message('This tracking link is not active.', 'The locksmith will send a link when they are on the way.'); clearInterval(timer); return; }
    title.textContent = 'Your locksmith is on the way.';
    if (session.latitude == null || session.longitude == null) {
      copy.textContent = 'Location sharing is starting. This page updates automatically.';
      locationBox.hidden = true;
    } else {
      copy.textContent = 'Approximate live location. For privacy, sharing stops when the locksmith arrives.';
      const map = new URL('https://www.openstreetmap.org/');
      map.searchParams.set('mlat', session.latitude);
      map.searchParams.set('mlon', session.longitude);
      map.hash = `map=16/${session.latitude}/${session.longitude}`;
      locationBox.innerHTML = `<a class="button button-dark" target="_blank" rel="noopener noreferrer" href="${map.href}">View current location on map</a>`;
      locationBox.hidden = false;
    }
    updated.textContent = session.updated_at ? `Last updated ${new Intl.DateTimeFormat('en-GB', { timeStyle: 'short' }).format(new Date(session.updated_at))}.` : '';
  } catch {
    message('We could not check this link.', 'Try again in a moment. If it keeps failing, contact the locksmith.');
  }
}

if (!rawToken) message('Tracking link is incomplete.', 'Use the private link sent to your phone.');
else if (!backendReady()) message('Tracking is being set up.', backendMessage());
else { refresh(); timer = setInterval(refresh, 10000); }
