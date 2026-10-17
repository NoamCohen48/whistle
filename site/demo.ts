// Hero illustration: local navigation and state over sample data. No network, storage or terminal access.
type Phase = 'watching' | 'controlling' | 'disconnected';

const demo = document.querySelector<HTMLElement>('.demo');

if (demo) {
  const open = demo.querySelector<HTMLButtonElement>('[data-demo-open]')!;
  const back = demo.querySelector<HTMLButtonElement>('[data-demo-back]')!;
  const toggle = demo.querySelector<HTMLButtonElement>('[data-demo-toggle]')!;
  const drop = demo.querySelector<HTMLButtonElement>('[data-demo-drop]')!;
  const badge = demo.querySelector<HTMLElement>('[data-demo-badge]')!;
  const note = demo.querySelector<HTMLElement>('[data-demo-note]')!;
  const labels: Record<Phase, string> = { watching: 'Watching', controlling: 'Controlling', disconnected: 'Disconnected' };
  let reconnect: number | undefined;

  const show = (phase: Phase, message: string) => {
    demo.dataset.phase = phase;
    badge.textContent = labels[phase];
    toggle.textContent = phase === 'controlling' ? 'Release control' : 'Take control';
    toggle.disabled = drop.disabled = phase === 'disconnected';
    note.textContent = message;
  };

  const screen = (name: 'herd' | 'session') => {
    window.clearTimeout(reconnect);
    demo.dataset.screen = name;
    drop.hidden = name !== 'session';
    if (name === 'session') {
      show('watching', 'Watching. You see the agent live, and your desktop pane keeps its size and focus.');
      toggle.focus();
    } else {
      show('watching', 'Back on your herd. Leaving a pane hands control back.');
      open.focus();
    }
  };

  open.addEventListener('click', () => screen('session'));
  back.addEventListener('click', () => screen('herd'));

  toggle.addEventListener('click', () => {
    if (demo.dataset.phase === 'controlling') show('watching', 'Watching. Control released, and your desktop pane is back to how it was.');
    else show('controlling', 'Controlling. Your keys now go to the real terminal.');
  });

  drop.addEventListener('click', () => {
    window.clearTimeout(reconnect);
    show('disconnected', 'Disconnected. Nothing is being sent.');
    const pause = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1200;
    reconnect = window.setTimeout(() => show('watching', 'Reconnected, watching. Nothing was resent.'), pause);
  });
}
