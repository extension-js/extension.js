import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/coverage/**',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/types/**',
        '**/messages.ts',
        '**/rslib.config.*',
        '**/vitest.config.*',
        '**/webpack/**',
        '**/README.md',
        '**/CHANGELOG.md'
      ]
    },
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Exclude temporary test workspaces created under __spec__
      '**/__spec__/.tmp-**/**',
      '**/.tmp-tests/**'
    ],
    // Integration specs build real example projects under examples/.../dist.
    // Run in a single thread to avoid cross-spec interference on those folders.
    poolOptions: {
      threads: {singleThread: true, isolate: true}
    }
  }
})


