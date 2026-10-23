// Moves the .spotlight glow to follow the pointer. On touch screens a tap
// lights the card briefly, since there is no hover.
export function initSpotlight() {
  const cards = document.querySelectorAll<HTMLElement>('.spotlight');

  cards.forEach((card) => {
    const move = (e: PointerEvent) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    };

    card.addEventListener('pointermove', move);
    card.addEventListener('pointerdown', (e) => {
      move(e);
      if (e.pointerType !== 'mouse') {
        card.setAttribute('data-active', '');
        window.setTimeout(() => card.removeAttribute('data-active'), 900);
      }
    });
  });
}
