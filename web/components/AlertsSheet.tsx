import { useEffect, useRef, useState } from 'react';
import { loadAlertSettings, saveAlertSettings, type AlertSettings } from '../push.ts';
import { Sheet } from './Actions.tsx';

// Which alerts this phone gets. Stored on the PC per device, because the PC decides what to send.
const DEFAULT_QUIET = { start: '22:00', end: '07:00' };
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function AlertsSheet({ open, onClose, onTurnOff }: { open: boolean; onClose: () => void; onTurnOff: () => Promise<void> }) {
  const [settings, setSettings] = useState<AlertSettings>();
  const [quietTimes, setQuietTimes] = useState(DEFAULT_QUIET);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Saves run one after another so the PC always ends with the newest choice.
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    if (!open) return;
    let current = true;
    setSettings(undefined); setStatus(''); setError(''); setBusy(false);
    loadAlertSettings().then(value => {
      if (!current) return;
      setSettings(value);
      if (value.quiet) setQuietTimes({ start: value.quiet.start, end: value.quiet.end });
    }, cause => { if (current) setError((cause as Error).message); });
    return () => { current = false; };
  }, [open]);
  const save = (next: AlertSettings) => {
    setSettings(next); setStatus('Saving…'); setError('');
    queue.current = queue.current.then(() => saveAlertSettings(next)).then(
      () => setStatus('Saved'), cause => { setStatus(''); setError((cause as Error).message); });
  };
  const quiet = (enabled: boolean, times = quietTimes) => settings && save({
    finished: settings.finished, ...(enabled && times.start !== times.end ? { quiet: { ...times, timeZone: timeZone() } } : {}),
  });
  return <Sheet id="alerts-sheet" open={open} title="Alerts" onClose={() => { if (!busy) onClose(); }}>
    {!settings ? error ? <p className="sheet-error" role="alert">{error}</p> : <p className="sheet-status" role="status">Loading…</p> : <div className="sheet-form">
      <p className="sheet-note">You’re alerted when an agent needs you, unless you have its pane open.</p>
      <label className="check"><input type="checkbox" id="alert-finished" checked={settings.finished}
        onChange={event => save({ ...settings, finished: event.target.checked })} />
        <span>Also when an agent finishes</span></label>
      <label className="check"><input type="checkbox" id="alert-quiet" checked={Boolean(settings.quiet)}
        onChange={event => quiet(event.target.checked)} />
        <span>Quiet hours<small>Alerts still arrive, without sound or vibration</small></span></label>
      {settings.quiet ? <div className="quiet-times">
        {(['start', 'end'] as const).map(edge => <label className="field" key={edge}>{edge === 'start' ? 'From' : 'Until'}
          <input type="time" id={`quiet-${edge}`} required value={quietTimes[edge]} onChange={event => {
            const times = { ...quietTimes, [edge]: event.target.value };
            setQuietTimes(times);
            if (/^\d\d:\d\d$/.test(times[edge])) quiet(true, times);
          }} /></label>)}
      </div> : null}
      <p id="alerts-status" className="sheet-status" role="status">{status}</p>
      {error ? <p className="sheet-error" role="alert">{error}</p> : null}
      <button type="button" id="alerts-off" className="danger" disabled={busy} onClick={() => {
        setBusy(true);
        void onTurnOff().catch(cause => setError((cause as Error).message)).finally(() => setBusy(false));
      }}>{busy ? 'Turning off…' : 'Turn off alerts on this phone'}</button>
    </div>}
  </Sheet>;
}
