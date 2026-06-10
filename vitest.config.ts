import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Tests run under Node while the app's better-sqlite3 is rebuilt for Electron's ABI.
    // Alias to a Node-ABI copy (npm-alias devDep) so the same sources load in both runtimes.
    alias: { 'better-sqlite3': 'better-sqlite3-node' }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'out', 'dist', 'src/**/*.integration.test.ts']
  }
})
