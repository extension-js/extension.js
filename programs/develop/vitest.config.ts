import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true
      }
    },
    mockReset: true,
    restoreMocks: true,
    testTimeout: 120e3,
    globals: true,
    environment: 'node',
    include: ['webpack/**/__spec__/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/types/**'
      ]
    }
  }
})
