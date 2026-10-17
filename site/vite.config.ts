import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Deliberately independent of the private app's root Vite configuration.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './', // Works on both owner.github.io/ and owner.github.io/whistle/.
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL('../site-dist', import.meta.url)),
    emptyOutDir: true,
  },
  server: { host: '127.0.0.1', port: 5175, strictPort: true },
  preview: { host: '127.0.0.1', strictPort: true },
});
