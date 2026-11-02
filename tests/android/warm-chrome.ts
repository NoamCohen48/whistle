// Opens Chrome once before the tests, so the first test finds it warm. Chrome's first start on a
// freshly booted emulator can take long enough that the first test's tab never reached DevTools
// in time; later starts are quick. Does nothing without a device; the tests then skip or fail.
import { execFileSync } from 'node:child_process';

const devtools = 9333;
const adb = (...args: string[]) => execFileSync('adb', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export default async function warmChrome() {
  try { if (adb('get-state').trim() !== 'device') return; } catch { return; }
  adb('shell', `echo '_ --disable-fre --no-first-run --no-default-browser-check' > /data/local/tmp/chrome-command-line`);
  adb('shell', 'am', 'set-debug-app', 'com.android.chrome');
  try { adb('shell', 'pm', 'grant', 'com.android.chrome', 'android.permission.POST_NOTIFICATIONS'); } catch {}
  adb('reverse', 'tcp:8793', 'tcp:8793');
  adb('forward', `tcp:${devtools}`, 'localabstract:chrome_devtools_remote');
  try {
    adb('shell', `am start -a android.intent.action.VIEW -d 'http://localhost:8793/__test/health' com.android.chrome`);
    // Ready once DevTools lists a page: the same point the tests wait for.
    const start = Date.now();
    while (Date.now() - start < 120_000) {
      const pages = await fetch(`http://127.0.0.1:${devtools}/json/list`).then(response => response.json() as Promise<{ type: string }[]>, () => []);
      if (pages.some(page => page.type === 'page')) { console.log(`Chrome is warm after ${Math.round((Date.now() - start) / 1000)}s.`); return; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    console.warn('Chrome did not show a page within two minutes; the tests will try anyway.');
  } finally {
    adb('shell', 'am', 'force-stop', 'com.android.chrome');
    adb('shell', 'am', 'clear-debug-app');
    adb('forward', '--remove', `tcp:${devtools}`);
    adb('reverse', '--remove', 'tcp:8793');
  }
}
