import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = __dirname

/** The browser build of the renderer, served by the desktop app on 127.0.0.1 (src/main/bridge.ts). Output: out/web. */
export default defineConfig({
  root: resolve(root, 'src/renderer'),
  base: './',
  plugins: [react()],
  define: { __WEB__: 'true' },
  resolve: { alias: { '@sogoma': resolve(root, 'kit') } },
  server: { fs: { allow: [root] } },
  build: {
    outDir: resolve(root, 'out/web'),
    emptyOutDir: true,
    // Same rule as the desktop build: the page's CSP allows fonts and images from its own origin only.
    assetsInlineLimit: 0,
    rollupOptions: { input: { index: resolve(root, 'src/renderer/web.html') } }
  }
})
