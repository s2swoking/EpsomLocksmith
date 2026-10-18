'use strict';
(() => {
  const form = document.getElementById('enquiry-form');
  if (!form) return;
  const service = document.getElementById('enquiry-service');
  const file = document.getElementById('enquiry-file');
  const feedback = document.getElementById('file-feedback');
  const remove = document.getElementById('remove-attachment');
  const submit = form.querySelector('[type="submit"]');
  const status = document.getElementById('enquiry-status');
  const maxFileBytes = 3000000;
  const types = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime' };
  let ready = false;
  let sending = false;
  let requestId = null;
  form.addEventListener('input', () => { if (!sending) requestId = null; });
  form.addEventListener('change', () => { if (!sending) requestId = null; });

  function setStatus(message, state = '') {
    status.textContent = message;
    status.dataset.state = state;
  }
  const choices = new Set(Array.from(service.options, option => option.value));
  document.querySelectorAll('[data-service]').forEach(link => link.addEventListener('click', () => {
    if (choices.has(link.dataset.service)) { service.value = link.dataset.service; requestId = null; }
  }));

  function validateAttachment() {
    file.setCustomValidity('');
    const selected = file.files[0];
    remove.hidden = !selected;
    if (!selected) { feedback.textContent = ''; return true; }
    const extension = selected.name.split('.').pop().toLowerCase();
    if (!types[extension] || (selected.type && types[extension] !== selected.type)) file.setCustomValidity('Choose a JPG, PNG, WebP, MP4 or MOV file.');
    else if (!selected.size) file.setCustomValidity('The file is empty. Please choose another file.');
    else if (selected.size > maxFileBytes) file.setCustomValidity('Please choose a file no larger than 3 MB.');
    feedback.textContent = file.validationMessage || selected.name + ' · ' + (selected.size / 1000000).toFixed(2) + ' MB · ready to send';
    return file.validity.valid;
  }
  file.addEventListener('change', validateAttachment);
  remove.addEventListener('click', () => { file.value = ''; requestId = null; validateAttachment(); });

  fetch('/api/contact', { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    .then(async response => {
      const result = await response.json();
      if (!response.ok || result.ready !== true) throw new Error('Unavailable');
      ready = true;
      submit.disabled = false;
      setStatus('For urgent help, call 020 4505 8291.');
    })
    .catch(() => setStatus('Online enquiries are temporarily unavailable. Please call 020 4505 8291.', 'error'));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!ready || sending) return;
    validateAttachment();
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    requestId ||= crypto.randomUUID();
    data.set('requestId', requestId);
    if (!file.files.length) data.delete('attachment');
    sending = true;
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    const label = submit.querySelector('span');
    label.textContent = 'Sending…';
    setStatus('Sending your enquiry. Please keep this page open.');
    try {
      const response = await fetch('/api/contact', {
        method: 'POST', body: data, signal: AbortSignal.timeout(25000),
      });
      const result = await response.json();
      if (response.status === 409) requestId = null;
      if (!response.ok || result.sent !== true || result.reference !== requestId) {
        const message = typeof result.error === 'string' ? result.error : 'We could not confirm your enquiry was sent. Please call 020 4505 8291 before trying again.';
        setStatus(message, 'error');
        return;
      }
      form.reset();
      requestId = null;
      validateAttachment();
      setStatus('Thank you. Your enquiry has been received. We’ll get back to you using the contact details you provided.', 'success');
      status.focus();
    } catch {
      setStatus('We could not confirm your enquiry was sent. Please call 020 4505 8291 before trying again. Your details are still here.', 'error');
    } finally {
      sending = false;
      submit.disabled = !ready;
      form.removeAttribute('aria-busy');
      label.textContent = 'Send enquiry';
    }
  });
})();

