// "Report a problem": a new GitHub issue filled in with what helps, the versions, the browser and
// the last message Whistle showed. No pane names, terminal text or addresses are added. Nothing
// is sent from here; the person reads and edits it on GitHub before submitting.
const version = typeof WHISTLE_VERSION === 'string' ? WHISTLE_VERSION : 'development';
const repository = typeof WHISTLE_REPOSITORY === 'string' ? WHISTLE_REPOSITORY : 'https://github.com/NoamCohen48/whistle';

export function reportUrl(lastMessage: string, browser = {
  userAgent: navigator.userAgent,
  installed: matchMedia('(display-mode: standalone)').matches,
  secure: location.protocol === 'https:',
  screen: `${screen.width}×${screen.height}`,
}) {
  const body = [
    '### What happened', '', '<!-- What did you do, what did you expect, and what happened instead? -->', '', '',
    '### Details', '',
    `- Whistle app: ${version}`,
    `- Browser: ${browser.userAgent}`,
    `- Installed as an app: ${browser.installed ? 'yes' : 'no'}`,
    `- HTTPS: ${browser.secure ? 'yes' : 'no'}`,
    `- Screen: ${browser.screen}`,
    ...(lastMessage ? [`- Last message shown: ${lastMessage.slice(0, 300)}`] : []),
    '', 'On the PC, `whistle version` shows the host version, and `journalctl --user -u whistle.service` its log.',
  ].join('\n');
  return `${repository}/issues/new?${new URLSearchParams({ title: '', body })}`;
}
