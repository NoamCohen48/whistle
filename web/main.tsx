/// <reference types="vite/client" />
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './style.css';
import { App } from './App.tsx';
import { prepareSession } from './api.ts';

// Strip the one-time QR credential before requests or React's development lifecycle.
const ticket = new URLSearchParams(location.hash.slice(1)).get('pair');
if (ticket) history.replaceState(null, '', location.pathname + location.search);
const startup = prepareSession(ticket);
createRoot(document.getElementById('root')!).render(<StrictMode><App startup={startup} /></StrictMode>);
