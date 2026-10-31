import { validateChord } from '../shared/keys.ts';
import { readPreference, writePreference } from './preferences.ts';

// Quick replies and saved keys: short lists the person keeps on this phone for one-tap use.
// Saving tells any open view to read the list again.
const CHANGED = 'whistle-shortcuts-changed';
export const MAX_SHORTCUTS = 12;
export const MAX_REPLY_LENGTH = 500;
const DEFAULT_REPLIES = ['Continue', 'Yes, go ahead', 'Run the tests and fix any failures'];

export const readQuickReplies = () => readPreference<string[]>('quick-replies', DEFAULT_REPLIES);
export const readSavedKeys = () => readPreference<string[]>('saved-keys', []);

function save(key: string, list: string[]) {
  writePreference(key, list);
  window.dispatchEvent(new Event(CHANGED));
  return list;
}
export function addQuickReply(text: string) {
  const reply = text.trim();
  if (!reply) throw new Error('Write the reply first.');
  if (reply.length > MAX_REPLY_LENGTH) throw new Error(`Keep a quick reply under ${MAX_REPLY_LENGTH} characters.`);
  const list = readQuickReplies();
  if (list.includes(reply)) return list;
  if (list.length >= MAX_SHORTCUTS) throw new Error(`You can keep ${MAX_SHORTCUTS} quick replies. Remove one first.`);
  return save('quick-replies', [...list, reply]);
}
export const removeQuickReply = (text: string) => save('quick-replies', readQuickReplies().filter(item => item !== text));

// A saved key is stored as its canonical chord, so "Ctrl+Shift+P" and "ctrl+shift+P" are one key.
export function addSavedKey(value: string) {
  const key = validateChord(value.trim());
  const list = readSavedKeys();
  if (list.includes(key)) return list;
  if (list.length >= MAX_SHORTCUTS) throw new Error(`You can keep ${MAX_SHORTCUTS} saved keys. Remove one first.`);
  return save('saved-keys', [...list, key]);
}
export const removeSavedKey = (key: string) => save('saved-keys', readSavedKeys().filter(item => item !== key));

// "ctrl+shift+p" reads as "Ctrl+Shift+P" on a key.
export const keyLabel = (key: string) => key.split('+').map(part => part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)).join('+');

export function onShortcutsChanged(listener: () => void) {
  window.addEventListener(CHANGED, listener);
  return () => window.removeEventListener(CHANGED, listener);
}
