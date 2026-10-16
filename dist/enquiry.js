'use strict';
(() => {
  const form = document.getElementById('enquiry-form');
  if (!form) return;
  const service = document.getElementById('enquiry-service');
  const file = document.getElementById('enquiry-file');
  const feedback = document.getElementById('file-feedback');
  const remove = document.getElementById('remove-attachment');
  // Layout is available for review; sending stays off until email delivery is connected.
  form.addEventListener('submit', event => {
    event.preventDefault();
    document.getElementById('enquiry-status').textContent = 'Online enquiries are not available yet. No details or files have been sent.';
  });
  const choices = new Set(Array.from(service.options, option => option.value));
  document.querySelectorAll('[data-service]').forEach(link => link.addEventListener('click', () => {
    if (choices.has(link.dataset.service)) service.value = link.dataset.service;
  }));
  function validateAttachment() {
    file.setCustomValidity('');
    const selected = file.files[0];
    remove.hidden = !selected;
    if (!selected) { feedback.textContent = ''; return; }
    const types = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'];
    if (!types.includes(selected.type)) file.setCustomValidity('Choose a JPG, PNG, WebP, MP4 or MOV file.');
    else if (selected.size > 10 * 1024 * 1024) file.setCustomValidity('Please choose a file smaller than 10 MB.');
    feedback.textContent = file.validationMessage || selected.name + ' · selected on this device only';
  }
  file.addEventListener('change', validateAttachment);
  remove.addEventListener('click', () => { file.value = ''; validateAttachment(); });
})();
