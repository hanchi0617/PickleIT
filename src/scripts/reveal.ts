import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

// Fades/slides elements marked [data-reveal] into view as they scroll in.
// Siblings inside a [data-reveal-group] stagger. Uses only transform + opacity,
// and is skipped when the user prefers reduced motion.
export function initReveal() {
  const root = document.documentElement;
  if (root.classList.contains('reveal-timeout')) return;
  root.classList.add('reveal-ready');

  const els = gsap.utils.toArray<HTMLElement>('[data-reveal]');
  if (!els.length) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    gsap.set(els, { opacity: 1 });
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  ScrollTrigger.batch(els, {
    start: 'top 90%',
    once: true,
    onEnter: (batch) =>
      gsap.fromTo(
        batch,
        { opacity: 0, y: 28 },
        { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', stagger: 0.08, overwrite: true },
      ),
  });
}
