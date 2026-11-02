import type { Modifier } from '../../shared/keys.ts';

// The terminal's state as React sees it. Kept apart from session.ts, which brings in xterm and
// is only loaded once a pane opens.
export type Phase = 'idle' | 'connecting' | 'requesting-control' | 'watching' | 'controlling' | 'disconnected' | 'paused';
export interface SessionState {
  phase: Phase;
  fitWidth: boolean;
  fontSize: number;
  modifiers: Modifier[];
  // Locked modifiers stay armed after each key, for a run of chords such as Ctrl+N, Ctrl+N.
  modifiersLocked: boolean;
  error: string;
}
export const INITIAL_SESSION: SessionState = { phase: 'idle', fitWidth: true, fontSize: 13, modifiers: [], modifiersLocked: false, error: '' };
