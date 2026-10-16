import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Development only. Production serves the built UI and API from one Bun origin.
const target = process.env.WHISTLE_API_URL || 'http://127.0.0.1:8790';
let targetOrigin: string;
try { targetOrigin = new URL(target).origin; }
catch (cause) { throw new Error('WHISTLE_API_URL must be a valid HTTP(S) URL', { cause }); }
if (!/^https?:\/\//.test(targetOrigin)) throw new Error('WHISTLE_API_URL must use HTTP(S)');
export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    host: '127.0.0.1', strictPort: true,
    proxy: {
      '^/api/': {
        target, changeOrigin: true,
        configure(proxy) { proxy.on('proxyReq', request => request.setHeader('origin', targetOrigin)); },
      },
      '^/terminal([?]|$)': { target, changeOrigin: true, ws: true, rewriteWsOrigin: true },
    },
  },
  build: {
    outDir: '../dist', emptyOutDir: true, cssCodeSplit: false,
    // Keep the existing host's explicit static-asset allowlist; no broad file serving.
    rolldownOptions: { output: {
      entryFileNames: 'app.js',
      assetFileNames: asset => asset.names.some(name => name.endsWith('.css')) ? 'app.css' : 'assets/[name]-[hash][extname]',
    } },
  },
});
