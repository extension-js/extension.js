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
    include: ['webpack/**/__spec__/*.spec.ts', 'build.spec.ts'],
    // Exclude the index.spec.ts file in the webpack directory.
    // These tests fail for some reason on CI.
    // TODO: cezaraugusto - fix these tests
    exclude: ['webpack/**/__spec__/index.spec.ts'],
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
