import { useRef, useState } from 'react';
import { Icon } from './Icon.tsx';

export function Pairing({ hidden, loading, error, unavailable = false, onPair, onRetry }: {
  hidden: boolean; loading: boolean; error: string; unavailable?: boolean; onPair: (token: string) => Promise<void>; onRetry: () => void;
}) {
  const token = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  return <section id="pair" className="pair" hidden={hidden}>
    <p className="brand"><span className="wordmark">whistle</span></p>
    <form id="pair-form" onSubmit={async event => {
      event.preventDefault();
      if (submitting) return;
      setSubmitting(true);
      try { await onPair(token.current?.value.trim() || ''); if (token.current) token.current.value = ''; }
      finally { setSubmitting(false); }
    }}>
      <h1>{unavailable ? 'Cannot reach your PC' : loading ? 'Connecting to your PC' : 'Pair this phone'}</h1>
      {unavailable ? <p className="recovery-help">Check that your PC is awake, Whistle is running, and Tailscale is connected on both devices. Retrying will check your existing pairing.</p> : null}
      <ol className="steps" hidden={unavailable || loading}>
        <li>On your PC, run <code>whistle pair</code></li>
        <li>Scan the QR with this phone’s camera</li>
      </ol>
      {loading ? <p className="pair-status" role="status"><Icon name="scan" size={18} />Connecting to your PC…</p> : null}
      {error ? <div className="pair-problem">
        <p id="pair-error" role="alert">{error}</p>
        <button type="button" disabled={loading || submitting} onClick={onRetry}><Icon name="refresh" size={18} />Retry connection</button>
      </div> : <p id="pair-error" role="alert" hidden />}
      <details hidden={unavailable || loading}><summary>Use an access token instead</summary>
        <label htmlFor="token">PC access token</label>
        <input id="token" ref={token} type="password" required autoComplete="off" spellCheck={false} disabled={loading || submitting} />
        <button className="primary" type="submit" disabled={loading || submitting}>{submitting ? 'Pairing…' : 'Pair browser'}</button>
      </details>
    </form>
  </section>;
}
