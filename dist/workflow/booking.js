import { backendReady, backendMessage, rest, showMessage } from './common.js';

const form = document.getElementById('booking-form');
if (form) {
  const timing = form.elements.timing;
  const scheduledFields = document.getElementById('scheduled-fields');
  const dateField = form.elements.appointment_date;
  const timeField = form.elements.appointment_time;
  const message = document.getElementById('booking-message');
  document.querySelectorAll('[data-booking-service]').forEach(link => link.addEventListener('click', () => {
    form.elements.service.value = link.dataset.bookingService;
  }));
  const now = new Date();
  dateField.min = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  timing.addEventListener('change', () => {
    scheduledFields.hidden = timing.value !== 'scheduled';
    dateField.required = timeField.required = timing.value === 'scheduled';
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!backendReady()) { showMessage(message, backendMessage(), 'error'); return; }
    const data = new FormData(form);
    const scheduled = data.get('timing') === 'scheduled';
    let appointmentStart = new Date().toISOString();
    if (scheduled) {
      const localStart = new Date(`${data.get('appointment_date')}T${data.get('appointment_time')}`);
      if (!Number.isFinite(localStart.getTime()) || localStart < new Date()) {
        showMessage(message, 'Choose a date and time in the future.', 'error'); return;
      }
      appointmentStart = localStart.toISOString();
    }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    showMessage(message, 'Sending your request…');
    try {
      await rest('/functions/v1/request-booking', {
        method: 'POST',
        body: JSON.stringify({
          service: data.get('service'),
          customer_name: String(data.get('customer_name')).trim(),
          customer_phone: String(data.get('customer_phone')).trim(),
          address: String(data.get('address')).trim(),
          postcode: String(data.get('postcode')).trim().toUpperCase(),
          notes: String(data.get('notes') || '').trim() || null,
          appointment_start: appointmentStart,
          appointment_duration_minutes: data.get('service') === 'emergency_opening' ? 90 : 60
        })
      });
      form.reset();
      scheduledFields.hidden = true;
      dateField.required = timeField.required = false;
      showMessage(message, 'Request received. It is pending until the locksmith confirms the time with you.', 'success');
    } catch (error) {
      showMessage(message, error.message || 'We could not send your request. Please try again or call the locksmith.', 'error');
    } finally { submit.disabled = false; }
  });
}
