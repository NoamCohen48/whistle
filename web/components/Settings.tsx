import { useEffect, useState } from 'react';
import type { Device } from '../../shared/api.ts';
import { PairingRequired, errorMessage, request } from '../request.ts';
import type { AlertState } from '../push.ts';
import { Sheet } from './Actions.tsx';

type BrowserDevice = Device & { current: boolean };
const date = (value: number) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value);

export function SettingsSheet({ open, onClose, alerts, alertsBusy, onAlerts }: {
  open: boolean; onClose: () => void; alerts: AlertState; alertsBusy: boolean; onAlerts: () => Promise<string | undefined>;
}) {
  const [devices, setDevices] = useState<BrowserDevice[]>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState<BrowserDevice>();
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setDevices(undefined); setError(''); setPending(undefined);
    void request('/api/devices', { signal: controller.signal }).then(response => response.json()).then(
      value => { if (!controller.signal.aborted) setDevices(value.devices); },
      cause => { if (!controller.signal.aborted) setError(errorMessage(cause)); });
    return () => controller.abort();
  }, [open, revision]);
  const revoke = async () => {
    if (!pending || busy) return;
    setBusy(true); setError('');
    try {
      await request(`/api/devices/${encodeURIComponent(pending.id)}`, { method: 'DELETE' });
      if (pending.current) { new PairingRequired(); onClose(); }
      else setDevices(previous => previous?.filter(device => device.id !== pending.id));
      setPending(undefined);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  return <Sheet id="settings-sheet" open={open} title="Settings" onClose={() => { if (!busy) onClose(); }}>
    <section className="settings-section" aria-labelledby="notifications-heading">
      <h3 id="notifications-heading">Notifications</h3>
      {alerts === 'blocked' || alerts === 'unsupported' ? <p className="sheet-note">{alerts === 'blocked'
        ? 'Notifications are blocked. In your browser’s site settings, allow notifications for Whistle, then return here.'
        : 'Alerts need HTTPS and a supported browser. On iPhone, install Whistle to your Home Screen first.'}</p> : null}
      {alerts !== 'unsupported' && alerts !== 'blocked' ? <button type="button" disabled={alertsBusy} onClick={() => { void onAlerts().then(message => setError(message || ''), cause => setError(errorMessage(cause))); }}>
        {alertsBusy ? 'Updating…' : alerts === 'on' ? 'Alert settings' : 'Turn on alerts'}</button> : null}
    </section>
    <section className="settings-section" aria-labelledby="devices-heading">
      <h3 id="devices-heading">Paired devices</h3>
      {error ? <div className="sheet-error" role="alert">{error}</div> : null}
      {!devices && !error ? <p className="sheet-status" role="status">Loading devices…</p> : null}
      {!devices && error ? <button type="button" onClick={() => setRevision(value => value + 1)}>Retry</button> : null}
      <ul className="device-list">{devices?.map(device => <li key={device.id}>
        <div><strong>{device.name}{device.current ? ' (this browser)' : ''}</strong>
          <small>Last seen {date(device.lastSeenAt)}</small><small>Pairing expires {date(device.expiresAt)}</small></div>
        <button type="button" className="revoke" disabled={busy} onClick={() => setPending(device)} aria-label={`Revoke ${device.name}`}>Revoke</button>
      </li>)}</ul>
      {pending ? <div className="confirm device-confirm">
        <p>Revoke {pending.name}? {pending.current ? 'This browser will need a new pairing QR.' : 'It will need a new pairing QR to connect again.'}</p>
        <div className="confirm-actions"><button type="button" disabled={busy} onClick={() => setPending(undefined)}>Cancel</button>
          <button type="button" id="revoke-confirm" className="danger" disabled={busy} onClick={() => void revoke()}>{busy ? 'Revoking…' : 'Revoke device'}</button></div>
      </div> : null}
    </section>
  </Sheet>;
}
