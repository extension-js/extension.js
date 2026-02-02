import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Integration specs build real example projects under examples/.../dist.
    // Run in a single worker to avoid cross-spec interference on those folders.
    pool: 'forks',
    maxWorkers: 1,
    testTimeout: 30000,
    hookTimeout: 45000,
    include: [
      '__spec__/unit/**/*.spec.ts',
      'webpack/**/__spec__/**/*.spec.ts',
      'webpack/**/__spec__/**/*.spec.tsx',
      'webpack/**/__spec__/**/*.spec.js',
      'webpack/**/__spec__/**/*.spec.jsx'
    ],
    setupFiles: ['webpack/__spec__/setup/cleanup.ts'],
    // coverage disabled
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Exclude temporary test workspaces created under __spec__
      '**/__spec__/.tmp-**/**',
      '**/.tmp-tests/**'
    ],
    allowOnly: !process.env.CI
  }
})


