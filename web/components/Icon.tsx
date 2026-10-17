// Inline 20px stroke icons. Decorative: buttons carry their own text or aria-label.
const paths = {
  back: 'M12.5 4.5 7 10l5.5 5.5',
  forward: 'M7.5 4.5 13 10l-5.5 5.5',
  refresh: 'M16 10a6 6 0 1 1-1.76-4.24M16 3.5v3h-3',
  cursor: 'M10 3.5v9M6 9l4 4 4-4M4.5 16.5h11',
  keyboard: 'M3 5.5h14v9H3zM6 8.5h.01M9 8.5h.01M12 8.5h.01M14.5 8.5h.01M6.5 11.5h7',
  compose: 'M4 16h3.5L16 7.5 12.5 4 4 12.5zM11 5.5 14.5 9',
  keys: 'M7 7v6m6-6v6M7 7H5.5A1.5 1.5 0 1 1 7 5.5zm6 0h1.5A1.5 1.5 0 1 0 13 5.5zM7 13H5.5A1.5 1.5 0 1 0 7 14.5zm6 0h1.5a1.5 1.5 0 1 1-1.5 1.5zM7 7h6M7 13h6',
  width: 'M3 10h14M6 7l-3 3 3 3M14 7l3 3-3 3',
  eye: 'M2.5 10s2.75-5 7.5-5 7.5 5 7.5 5-2.75 5-7.5 5-7.5-5-7.5-5zM10 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  branch: 'M6 4v8m0 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm8-6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 0c0 4-8 3-8 6',
  close: 'M5.5 5.5l9 9m0-9-9 9',
  scan: 'M3.5 7V4.5a1 1 0 0 1 1-1H7m6 0h2.5a1 1 0 0 1 1 1V7m0 6v2.5a1 1 0 0 1-1 1H13m-6 0H4.5a1 1 0 0 1-1-1V13M6.5 10h7',
  plus: 'M10 4v12M4 10h12',
  more: 'M10 4.5v.01M10 10v.01M10 15.5v.01',
  terminal: 'M3.5 4.5h13v11h-13zM6.5 8l2.5 2-2.5 2M10.5 12.5h3',
  agent: 'M10 3v3m0 8v3M3 10h3m8 0h3M5.5 5.5l2 2m5 5 2 2m0-9-2 2m-5 5-2 2',
  folder: 'M3 6a1 1 0 0 1 1-1h3.5L9 7h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  search: 'M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zm4.5-1.5L17 17',
  bell: 'M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 2h-13zM8.5 17.5a1.6 1.6 0 0 0 3 0',
  'bell-off': 'M5 13.5V9a5 5 0 0 1 .6-2.4M8 4.4A5 5 0 0 1 15 9v4.5l1.5 2H6M8.5 17.5a1.6 1.6 0 0 0 3 0M3 3l14 14',
  image: 'M3.5 4.5h13v11h-13zM3.5 13l4-4 3.5 3.5 2-2 3.5 3.5M12.5 8h.01',
  diff: 'M10 3.5v7M6.5 7h7M6.5 15.5h7',
  download: 'M10 3.5v8.5M6.5 8.5 10 12l3.5-3.5M4 13.5v2.5h12v-2.5',
  copy: 'M7 7V4.5A1 1 0 0 1 8 3.5h7.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H13M4.5 7H12a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z',
  text: 'M4 5h12M4 8.5h12M4 12h8M4 15.5h5',
  trash: 'M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor"
    strokeWidth={name === 'more' ? 3 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d={paths[name]} />
  </svg>;
}
