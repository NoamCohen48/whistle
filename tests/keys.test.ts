import { describe, expect, test } from 'bun:test';
import { chord, inputKey, validateChord } from '../shared/keys.ts';
import { parseCommand } from '../shared/protocol.ts';

describe('general terminal chords', () => {
  test('combines modifiers in canonical order', () => {
    expect(chord('p', ['shift', 'ctrl', 'alt'])).toBe('ctrl+alt+shift+p');
    expect(validateChord('Ctrl+Shift+P')).toBe('ctrl+shift+P');
    expect(chord('Enter', ['shift'])).toBe('shift+enter');
    expect(chord('ArrowLeft', ['ctrl', 'shift'])).toBe('ctrl+shift+left');
  });
  test('supports punctuation, function keys, navigation and Unicode', () => {
    expect(chord('+', ['ctrl'])).toBe('ctrl+plus');
    for (const key of ['f1', 'f12', 'f24', 'pageup', 'delete', '[', '\\', 'Ω', '🙂']) {
      expect(validateChord(chord(key, ['alt']))).toBe(`alt+${key}`);
    }
  });
  test('extracts one key from mobile terminal input, never a pasted string', () => {
    expect(inputKey('p')).toBe('p'); expect(inputKey('\r')).toBe('enter');
    expect(inputKey('\x1b[D')).toBe('left'); expect(inputKey('🙂')).toBe('🙂');
    expect(inputKey('pasted text')).toBeUndefined();
  });
  test('validates the socket key boundary without interpreting raw escape sequences', () => {
    expect(parseCommand('{"type":"key","id":1,"key":"ctrl+shift+enter"}')).toEqual({ type: 'key', id: 1, key: 'ctrl+shift+enter' });
    for (const key of ['', 'meta+p', 'ctrl+ctrl+p', 'ctrl+', '\x1b[A']) {
      expect(() => parseCommand(JSON.stringify({ type: 'key', id: 1, key }))).toThrow();
    }
  });
});
