import { describe, expect, test } from 'bun:test';
import { dimensions, parseCommand } from '../src/protocol.ts';

describe('terminal command boundary', () => {
  test('preserves raw input including Enter, deletion, arrows and Unicode', () => {
    const text = 'hello\x7f\x1b[D\rשלום🙂';
    expect(parseCommand(JSON.stringify({ type: 'input', id: 1, text }))).toEqual({ type: 'input', id: 1, text });
  });
  test('accepts terminal resize and scroll', () => {
    expect(parseCommand('{"type":"resize","cols":45,"rows":18}')).toEqual({ type: 'resize', cols: 45, rows: 18 });
    expect(parseCommand('{"type":"scroll","direction":"up","lines":8}').type).toBe('scroll');
  });
  test('rejects malformed JSON and unknown commands', () => {
    for (const input of ['{', 'null', '[]', '{"type":"exec","command":"rm"}', '{"type":"input","text":"x"}']) {
      expect(() => parseCommand(input)).toThrow();
    }
  });
  test('rejects oversized input, invalid ids and scroll floods', () => {
    expect(() => parseCommand(JSON.stringify({ type: 'input', id: 1, text: 'x'.repeat(65_537) }))).toThrow();
    expect(() => parseCommand(JSON.stringify({ type: 'input', id: -1, text: 'x' }))).toThrow();
    expect(() => parseCommand('{"type":"scroll","direction":"up","lines":101}')).toThrow();
  });
  test('bounds dimensions before invoking Herdr', () => {
    for (const [cols, rows] of [[0, 20], [501, 20], [40, 201], [40.5, 20], [NaN, 20]]) {
      expect(() => dimensions(cols, rows)).toThrow();
    }
  });
});
