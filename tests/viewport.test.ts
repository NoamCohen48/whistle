import { expect, test } from 'bun:test';
import { controlSize, inputScrollTop, pageScroll } from '../web/terminal/viewport.ts';

test('phone and keyboard-sized views keep a tall PTY for TUI chat above fixed widgets', () => {
  expect(controlSize(46, 27)).toEqual({ cols: 46, rows: 64 });
  expect(controlSize(46, 7)).toEqual({ cols: 46, rows: 64 });
  expect(controlSize(120, 90)).toEqual({ cols: 120, rows: 90 });
  expect(controlSize(999, 999)).toEqual({ cols: 500, rows: 200 });
});
test('follow input aligns the real cursor, not the terminal bottom/footer', () => {
  const top = inputScrollTop(48, 64, 1088, 560, 528);
  expect(top).toBe(281);
  expect(48 * 17 - top).toBeGreaterThan(0);
  expect(49 * 17 - top).toBeLessThanOrEqual(560);
  expect(top).toBeLessThan(528); // Footer remains below the phone's visible area.
  expect(inputScrollTop(0, 64, 1088, 560, 528)).toBe(0);
});
test('scrolling browses hidden local rows before requesting application history', () => {
  expect(pageScroll(281, 528, 'up', 136)).toEqual({ top: 145, remote: false });
  expect(pageScroll(145, 528, 'up', 200)).toEqual({ top: 0, remote: false });
  expect(pageScroll(0, 528, 'up', 136)).toEqual({ top: 0, remote: true });
  expect(pageScroll(528, 528, 'down', 136)).toEqual({ top: 528, remote: true });
});
