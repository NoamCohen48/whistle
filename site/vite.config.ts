import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// Download links are fixed at build time, so the page never calls the GitHub API.
// A fork's release workflow sets GITHUB_REPOSITORY; local builds use package.json.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string; repository: { url: string } };
const repository = process.env.GITHUB_REPOSITORY || pkg.repository.url.replace(/^https:\/\/github\.com\/|\.git$/g, '');
const release: Plugin = {
  name: 'whistle-release',
  transformIndexHtml: html => html.replaceAll('__WHISTLE_VERSION__', pkg.version).replaceAll('__WHISTLE_REPOSITORY__', repository),
};

// Deliberately independent of the private app's root Vite configuration.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './', // Works on both owner.github.io/ and owner.github.io/whistle/.
  publicDir: false,
  plugins: [release],
  build: {
    outDir: fileURLToPath(new URL('../site-dist', import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 0, // Keep every asset a same-origin file; no data: URLs.
  },
  server: { host: '127.0.0.1', port: 5175, strictPort: true },
  preview: { host: '127.0.0.1', strictPort: true },
});
