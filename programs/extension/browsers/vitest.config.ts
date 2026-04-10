import {defineConfig} from 'vitest/config'

export default defineConfig({
  resolve: {
    conditions: ['development', 'node', 'import', 'default']
  },
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    maxWorkers: 1,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    teardownTimeout: 120_000,
    include: ['__spec__/**/*.spec.ts'],
    sequence: {concurrent: false},
    allowOnly: !process.env.CI
  }
})
