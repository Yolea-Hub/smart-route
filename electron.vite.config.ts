import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const root = __dirname

export default defineConfig({
  main: {
    build: { rollupOptions: { input: { index: 'src/main/index.ts' } } }
  },
  preload: {
    build: { rollupOptions: { input: { index: 'src/preload/index.ts' } } }
  },
  renderer: {
    plugins: [react()],
    // The desktop build talks to the main process over IPC; the web build (vite.web.config.ts) over a WebSocket.
    define: { __WEB__: 'false' },
    // The vendored Sogoma kit (repo root, never edited by hand) is imported as @sogoma/...
    resolve: { alias: { '@sogoma': resolve(root, 'kit') } },
    // kit/ and assets/ sit outside the renderer folder: the dev server may serve them.
    server: { fs: { allow: [root] } },
    // The CSP allows fonts and images from the app's own origin only (no data: font): every file stays a file.
    build: { assetsInlineLimit: 0 }
  }
})
