// A short physical screen must not force a TUI's fixed footer to consume its chat area.
// Render a taller real terminal, then scroll the phone viewport around its actual cursor.
export const MIN_TERMINAL_ROWS = 64;
export function controlSize(cols: number, visibleRows: number) {
  return {
    cols: Math.min(500, Math.max(20, Math.floor(cols))),
    rows: Math.min(200, Math.max(MIN_TERMINAL_ROWS, Math.floor(visibleRows))),
  };
}
export function inputScrollTop(cursorRow: number, rows: number, screenHeight: number, viewportHeight: number, maxScroll: number) {
  const cell = screenHeight / Math.max(1, rows);
  // Keep the input at the lower edge, not the TUI footer below it.
  return Math.min(maxScroll, Math.max(0, (cursorRow + 1) * cell + 8 - viewportHeight));
}
export function pageScroll(top: number, maxScroll: number, direction: 'up' | 'down', pixels: number) {
  const atEdge = direction === 'up' ? top <= 1 : top >= maxScroll - 1;
  return {
    top: Math.max(0, Math.min(maxScroll, top + (direction === 'up' ? -pixels : pixels))),
    remote: atEdge,
  };
}
