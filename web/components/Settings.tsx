import { useEffect, useState } from 'react';
import type { Device } from '../../shared/api.ts';
import { PairingRequired, errorMessage, request } from '../request.ts';
import type { AlertState } from '../push.ts';
import { Sheet } from './Actions.tsx';
import { reportUrl } from '../report.ts';
import { addQuickReply, MAX_REPLY_LENGTH, readQuickReplies, removeQuickReply } from '../shortcuts.ts';

type BrowserDevice = Device & { current: boolean };
const date = (value: number) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value);

export function SettingsSheet({ open, onClose, alerts, alertsBusy, onAlerts, leftHanded, onHand, lastMessage }: {
  open: boolean; onClose: () => void; alerts: AlertState; alertsBusy: boolean; onAlerts: () => Promise<string | undefined>;
  leftHanded: boolean; onHand: (left: boolean) => void; lastMessage: string;
}) {
  const [devices, setDevices] = useState<BrowserDevice[]>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState<BrowserDevice>();
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [replies, setReplies] = useState(readQuickReplies);
  const [reply, setReply] = useState('');
  const [replyError, setReplyError] = useState('');
  useEffect(() => { if (open) { setReplies(readQuickReplies()); setReply(''); setReplyError(''); } }, [open]);
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
    <section className="settings-section" aria-labelledby="hand-heading">
      <h3 id="hand-heading">Controls</h3>
      <p className="sheet-note">Put Take control, Enter and Send on the side of the thumb you use. Saved on this phone.</p>
      <div className="choice" role="group" aria-label="Controls side">
        <button type="button" id="hand-left" aria-pressed={leftHanded} onClick={() => onHand(true)}>Left hand</button>
        <button type="button" id="hand-right" aria-pressed={!leftHanded} onClick={() => onHand(false)}>Right hand</button>
      </div>
    </section>
    <section className="settings-section" aria-labelledby="replies-heading">
      <h3 id="replies-heading">Quick replies</h3>
      <p className="sheet-note">One tap in Compose sends a reply and presses Enter. Saved on this phone.</p>
      {replies.length ? <ul id="reply-list" className="reply-list">{replies.map(text => <li key={text}>
        <div><strong>{text}</strong></div>
        <button type="button" className="revoke" aria-label={`Remove ${text}`} onClick={() => setReplies(removeQuickReply(text))}>Remove</button>
      </li>)}</ul> : null}
      <form id="reply-form" onSubmit={event => {
        event.preventDefault();
        try { setReplies(addQuickReply(reply)); setReply(''); setReplyError(''); }
        catch (cause) { setReplyError((cause as Error).message); }
      }}>
        <input id="new-reply" value={reply} maxLength={MAX_REPLY_LENGTH} placeholder="Looks good, commit it" aria-label="New quick reply"
          autoComplete="off" onChange={event => { setReply(event.target.value); setReplyError(''); }} />
        <button type="submit" disabled={!reply.trim()}>Add</button>
      </form>
      {replyError ? <p className="key-hint" data-error role="alert">{replyError}</p> : null}
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
    <section className="settings-section" aria-labelledby="help-heading">
      <h3 id="help-heading">Help</h3>
      <p className="sheet-note">Opens a new GitHub issue with the Whistle version, your browser and the last message Whistle showed. You can read and change it there before you send it.</p>
      <a id="report-problem" className="button-link" href={open ? reportUrl(lastMessage) : undefined} target="_blank" rel="noopener noreferrer">Report a problem</a>
    </section>
  </Sheet>;
}
