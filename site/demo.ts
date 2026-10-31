// Hero illustration: local navigation and state over sample data. No network, storage or terminal access.
type Phase = 'watching' | 'controlling' | 'disconnected';

const demo = document.querySelector<HTMLElement>('.demo');

if (demo) {
  const open = demo.querySelector<HTMLButtonElement>('[data-demo-open]')!;
  const back = demo.querySelector<HTMLButtonElement>('[data-demo-back]')!;
  const take = demo.querySelector<HTMLButtonElement>('[data-demo-take]')!;
  const release = demo.querySelector<HTMLButtonElement>('[data-demo-release]')!;
  const drop = demo.querySelector<HTMLButtonElement>('[data-demo-drop]')!;
  const badge = demo.querySelector<HTMLElement>('[data-demo-badge]')!;
  const note = demo.querySelector<HTMLElement>('[data-demo-note]')!;
  const labels: Record<Phase, string> = { watching: 'Watching', controlling: 'Controlling', disconnected: 'Disconnected' };
  let reconnect: number | undefined;

  const show = (phase: Phase, message: string) => {
    demo.dataset.phase = phase;
    badge.textContent = labels[phase];
    take.disabled = drop.disabled = phase === 'disconnected';
    note.textContent = message;
  };

  const screen = (name: 'herd' | 'session') => {
    window.clearTimeout(reconnect);
    demo.dataset.screen = name;
    drop.hidden = name !== 'session';
    if (name === 'session') {
      show('watching', 'Watching. You see the agent live, and your desktop pane keeps its size and focus.');
      take.focus();
    } else {
      show('watching', 'Back on your herd. Leaving a pane hands control back.');
      open.focus();
    }
  };

  open.addEventListener('click', () => screen('session'));
  back.addEventListener('click', () => screen('herd'));

  // As in the app, Take control sits in the watching bar and Release replaces Refresh in the header.
  take.addEventListener('click', () => {
    show('controlling', 'Controlling. Tap the terminal to type; your keys go to the real terminal.');
    release.focus();
  });
  release.addEventListener('click', () => {
    show('watching', 'Watching. Control released, and your desktop pane is back to how it was.');
    take.focus();
  });

  drop.addEventListener('click', () => {
    window.clearTimeout(reconnect);
    const focused = document.activeElement === release;
    show('disconnected', 'Disconnected. Nothing is being sent.');
    if (focused) drop.focus();
    const pause = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1200;
    reconnect = window.setTimeout(() => show('watching', 'Reconnected, watching. Nothing was resent.'), pause);
  });
}
