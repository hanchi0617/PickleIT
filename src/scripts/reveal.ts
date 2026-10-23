import { gsap } from 'gsap';

// Fades/slides elements marked [data-reveal] into view.
// Uses only transform + opacity, and is skipped when the user prefers reduced motion.
export function initReveal() {
  const els = document.querySelectorAll<HTMLElement>('[data-reveal]');
  if (!els.length) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  gsap.set(els, { opacity: 0, y: 24 });
  gsap.to(els, {
    opacity: 1,
    y: 0,
    duration: 0.6,
    ease: 'power2.out',
    stagger: 0.1,
  });
}
