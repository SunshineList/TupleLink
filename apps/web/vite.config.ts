import path from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import site from '../../docs/site/site.json'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The panel shows the plugin version, not the npm package version: apps/web
// still carries the upstream daed number, and showing 1.28.0 next to a 0.6.30
// package was actively misleading. site.json is the source the release tooling
// already validates against the Makefile, the installer and the workflow.
const version = site.version

export default defineConfig(() => {
  return {
    base: './',
    resolve: {
      alias: {
        '~': path.resolve(__dirname, 'src'),
        '@daeuniverse/dae-node-parser': path.resolve(__dirname, '../../packages/dae-node-parser/src/index.ts'),
        '@daeuniverse/dae-editor': path.resolve(__dirname, '../../packages/dae-editor/src/index.ts'),
      },
    },
    plugins: [react(), tailwindcss()],
    build: {
      chunkSizeWarningLimit: 10 * 1024 * 1024,
    },
    define: {
      'import.meta.env.APP_VERSION': JSON.stringify(version),
    },
    test: { globals: true },
  }
})
