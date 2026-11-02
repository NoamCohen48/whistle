import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../../shared/api.ts';
import { AWAY_MS, loadActivity, readLastLook, saveLastLook, summarise, type AwayRow } from '../away.ts';
import { age } from '../seen.ts';
import { Icon } from './Icon.tsx';

export interface Away { since: number; rows: AwayRow[] }

// Notes each look at the herd and, on coming back after a while, what agents did meanwhile.
export function useAway(paired: boolean, snapshot?: Snapshot) {
  const [away, setAway] = useState<Away>();
  const last = useRef(readLastLook());
  useEffect(() => {
    if (!paired || typeof snapshot?.now !== 'number' || document.hidden) return;
    const previous = last.current;
    last.current = { hostNow: snapshot.now, localAt: Date.now() };
    saveLastLook(last.current);
    if (!previous || Date.now() - previous.localAt < AWAY_MS) return;
    const controller = new AbortController();
    void loadActivity(previous.hostNow, controller.signal).then(events => {
      const rows = summarise(events);
      if (rows.length) setAway({ since: previous.localAt, rows });
    }, () => { /* No summary this time; the herd list is still current. */ });
    return () => controller.abort();
  }, [paired, snapshot]);
  return [away, () => setAway(undefined)] as const;
}

const SHOWN = 6;
export function AwaySummary({ away, onOpen, onDismiss }: { away?: Away; onOpen: (paneId: string) => void; onDismiss: () => void }) {
  if (!away) return null;
  const more = away.rows.length - SHOWN;
  return <section id="away" aria-labelledby="away-title">
    <header>
      <h2 id="away-title">While you were away<small>{age(away.since)}</small></h2>
      <button type="button" id="away-dismiss" className="icon-button" aria-label="Dismiss summary" onClick={onDismiss}><Icon name="close" size={18} /></button>
    </header>
    <ul>{away.rows.slice(0, SHOWN).map(row => {
      const copy = <>
        <strong>{row.name}{row.workspace ? <span>{row.workspace}</span> : null}</strong>
        <small><span data-kind={/needed you/.test(row.what) ? 'asked' : undefined}>{row.what}</span><span>{age(row.last) === 'now' ? 'just now' : `${age(row.last)} ago`}</span></small>
      </>;
      return <li key={row.paneId}>{row.closed ? <div className="away-row">{copy}</div>
        : <button type="button" className="away-row" data-pane={row.paneId} onClick={() => onOpen(row.paneId)}>{copy}</button>}</li>;
    })}</ul>
    {more > 0 ? <p className="away-more">and {more} more {more === 1 ? 'agent' : 'agents'}</p> : null}
  </section>;
}
