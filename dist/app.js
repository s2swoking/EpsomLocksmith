'use strict';

// Replace these two values when the business details are confirmed.
const business = { name: 'Epsom Local Locksmith', phone: '' };

document.querySelectorAll('[data-brand]').forEach(element => { element.textContent = business.name; });
document.getElementById('year').textContent = String(new Date().getFullYear());
if (window.lucide) window.lucide.createIcons();

const menuButton = document.querySelector('.menu-toggle');
const mobileNav = document.getElementById('mobile-nav');
function closeMenu() {
  mobileNav.hidden = true;
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Open navigation');
}
menuButton.addEventListener('click', () => {
  const expanded = menuButton.getAttribute('aria-expanded') !== 'true';
  mobileNav.hidden = !expanded;
  menuButton.setAttribute('aria-expanded', String(expanded));
  menuButton.setAttribute('aria-label', expanded ? 'Close navigation' : 'Open navigation');
});
mobileNav.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
window.matchMedia('(min-width: 801px)').addEventListener('change', event => { if (event.matches) closeMenu(); });

const phoneLink = document.querySelector('.contact-phone');
if (business.phone) {
  const dialNumber = business.phone.replace(/[^+\d]/g, '');
  phoneLink.href = 'tel:' + dialNumber;
  phoneLink.removeAttribute('aria-disabled');
  phoneLink.querySelector('span').textContent = business.phone;
  document.querySelector('.contact-status').textContent = 'Call for a quote and current arrival estimate.';
  document.querySelectorAll('.header-contact, .service-action').forEach(link => { link.href = phoneLink.href; });
} else {
  phoneLink.addEventListener('click', event => event.preventDefault());
}

const hero = document.querySelector('.hero');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let framePending = false;
function updateLockMotion() {
  framePending = false;
  const bounds = hero.getBoundingClientRect();
  const progress = Math.min(1, Math.max(0, -bounds.top / bounds.height));
  const amount = reducedMotion.matches ? 0.15 : 1;
  hero.style.setProperty('--lock-y', `${progress * 24 * amount}px`);
  hero.style.setProperty('--lock-angle', `${-7 + progress * 18 * amount}deg`);
}
window.addEventListener('scroll', () => {
  if (!framePending) { framePending = true; requestAnimationFrame(updateLockMotion); }
}, { passive: true });
reducedMotion.addEventListener('change', updateLockMotion);
updateLockMotion();
