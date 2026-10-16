export type Modifier = 'ctrl' | 'alt' | 'shift';
export const modifierOrder: Modifier[] = ['ctrl', 'alt', 'shift'];
const aliases: Record<string, string> = {
  escape: 'esc', arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right',
  ' ': 'space', '+': 'plus', '-': 'minus', '\r': 'enter', '\t': 'tab', '\x7f': 'backspace',
};
export const namedKeys = ['esc', 'tab', 'enter', 'backspace', 'delete', 'insert', 'home', 'end', 'pageup', 'pagedown', 'up', 'down', 'left', 'right', 'space', 'plus', 'minus'];

export function chord(key: string, modifiers: Iterable<Modifier> = []): string {
  const alias = Object.hasOwn(aliases, key.toLowerCase()) ? aliases[key.toLowerCase()] : undefined;
  const base = alias || ([...key].length === 1 ? key : key.toLowerCase());
  if (!base || /[\x00-\x1f\x7f]/.test(base) || base.includes('+') || base.length > 40) throw new Error('Choose one key or a named key such as enter or F12');
  const armed = new Set(modifiers);
  return [...modifierOrder.filter(m => armed.has(m)), base].join('+');
}

export function validateChord(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 80 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Invalid key chord');
  if (value === '+') return 'plus';
  const pieces = value.split('+');
  const base = pieces.pop() || '';
  const parts = pieces.map(p => p.toLowerCase());
  if (!base || parts.some(p => !modifierOrder.includes(p as Modifier)) || new Set(parts).size !== parts.length) throw new Error('Invalid modifiers; use ctrl+alt+shift+key');
  return chord(base, parts as Modifier[]);
}

export function inputKey(data: string): string | undefined {
  const special: Record<string, string> = {
    '\r': 'enter', '\t': 'tab', '\x7f': 'backspace', '\x1b': 'esc',
    '\x1b[A': 'up', '\x1b[B': 'down', '\x1b[C': 'right', '\x1b[D': 'left',
  };
  if (Object.hasOwn(special, data)) return special[data];
  if ([...data].length === 1 && !/[\x00-\x1f\x7f]/.test(data)) return data;
  return undefined;
}
