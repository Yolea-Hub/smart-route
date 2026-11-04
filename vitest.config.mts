import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: { __WEB__: 'false' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000
  }
})
