import { useRef, useState } from 'react';

export function Pairing({ hidden, loading, error, onPair, onRetry }: {
  hidden: boolean; loading: boolean; error: string; onPair: (token: string) => Promise<void>; onRetry: () => void;
}) {
  const token = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  return <section id="pair" className="pair" hidden={hidden}>
    <form id="pair-form" onSubmit={async event => {
      event.preventDefault();
      if (submitting) return;
      setSubmitting(true);
      try { await onPair(token.current?.value.trim() || ''); if (token.current) token.current.value = ''; }
      finally { setSubmitting(false); }
    }}>
      <p className="brand">whistle <span>Herdr remote</span></p>
      <h1>Your terminal.<br />Your phone.</h1>
      <p>On your PC, run <code>bun run pair</code>, then scan the QR with your phone’s camera. This browser pairs automatically.</p>
      <p className="hint">Each QR works once and expires after five minutes.</p>
      <details><summary>Use an access token instead</summary>
        <label htmlFor="token">PC access token</label>
        <input id="token" ref={token} type="password" required autoComplete="off" spellCheck={false} disabled={loading || submitting} />
        <p className="hint">Stored in Whistle’s private state directory on the PC.</p>
        <button className="primary" type="submit" disabled={loading || submitting}>{submitting ? 'Pairing…' : 'Pair browser'}</button>
      </details>
      {loading ? <p role="status">Connecting to your PC…</p> : null}
      <p id="pair-error" role="alert">{error}</p>
      {error ? <button type="button" disabled={loading || submitting} onClick={onRetry}>Retry connection</button> : null}
    </form>
  </section>;
}
