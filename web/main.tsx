/// <reference types="vite/client" />
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './style.css';
import { App } from './App.tsx';
import { prepareSession } from './api.ts';
import { registerInstallSupport } from './pwa.ts';

// Strip the one-time QR credential before requests or React's development lifecycle.
const fragment = new URLSearchParams(location.hash.slice(1));
const ticket = fragment.get('pair');
// An alert opened from a closed app names its pane; it opens watch-only like a restored selection.
const alertPane = fragment.get('pane');
if (alertPane && /^[A-Za-z0-9:_.-]{1,128}$/.test(alertPane)) sessionStorage.setItem('whistle-pane', alertPane);
// Home-screen shortcuts (long-press the icon) name one of a fixed set of starting points.
const shortcut = fragment.get('open');
if (shortcut && ['last', 'needs-you', 'new-agent'].includes(shortcut)) sessionStorage.setItem('whistle-shortcut', shortcut);
if (ticket || alertPane || shortcut) history.replaceState(null, '', location.pathname + location.search);
const startup = prepareSession(ticket);
registerInstallSupport();
createRoot(document.getElementById('root')!).render(<StrictMode><App startup={startup} /></StrictMode>);
