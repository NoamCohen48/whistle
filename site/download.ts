// Download section: switches every link and command between x86-64 and ARM64 builds,
// and copies commands. Links work without this script (x86-64). No requests or storage.
type Arch = 'x64' | 'arm64';

const files: Record<Arch, Record<string, string>> = {
  x64: { deb: 'whistle_amd64.deb', rpm: 'whistle.x86_64.rpm', arch: 'whistle-x86_64.pkg.tar.zst', tar: 'whistle-linux-x64.tar.gz', bin: 'whistle-linux-x64' },
  arm64: { deb: 'whistle_arm64.deb', rpm: 'whistle.aarch64.rpm', arch: 'whistle-aarch64.pkg.tar.zst', tar: 'whistle-linux-arm64.tar.gz', bin: 'whistle-linux-arm64' },
};

const section = document.querySelector<HTMLElement>('#download');

if (section) {
  const show = (arch: Arch) => {
    for (const [kind, file] of Object.entries(files[arch])) {
      section.querySelectorAll<HTMLElement>(`[data-file="${kind}"]`).forEach(node => { node.textContent = file; });
      section.querySelectorAll<HTMLElement>(`[data-command="${kind}"]`).forEach(node => { node.textContent = node.dataset.template!.replaceAll('{file}', file); });
      section.querySelectorAll<HTMLAnchorElement>(`[data-download="${kind}"]`).forEach(link => {
        link.href = link.href.replace(/[^/]+$/, file);
      });
    }
  };
  section.querySelectorAll<HTMLInputElement>('input[name="arch"]').forEach(input => {
    input.addEventListener('change', () => { if (input.checked) show(input.value as Arch); });
  });
  // A restored form state can differ from the markup's default after a reload.
  const checked = section.querySelector<HTMLInputElement>('input[name="arch"]:checked');
  if (checked) show(checked.value as Arch);

  // Clipboard needs a secure context; without it the button stays hidden and the text is selectable.
  if (navigator.clipboard) {
    section.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach(button => {
      const source = document.getElementById(button.dataset.copy!)!;
      let reset: number | undefined;
      button.hidden = false;
      button.addEventListener('click', async () => {
        const text = (source.textContent ?? '').replace(/^\$ /, '');
        try {
          await navigator.clipboard.writeText(text);
          button.textContent = 'Copied';
        } catch {
          button.textContent = 'Select and copy';
        }
        window.clearTimeout(reset);
        reset = window.setTimeout(() => { button.textContent = 'Copy'; }, 2000);
      });
    });
  }
}
