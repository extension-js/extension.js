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
      '__spec__/**/*.spec.ts',
      '__spec__/**/*.spec.tsx',
      '__spec__/**/*.spec.js',
      '__spec__/**/*.spec.jsx',
      'dev-server/**/__spec__/**/*.spec.ts',
      'feature-*/**/__spec__/**/*.spec.ts',
      'lib/**/__spec__/**/*.spec.ts',
      'plugin-*/**/__spec__/**/*.spec.ts',
      'plugin-*/**/__spec__/**/*.spec.tsx',
      'plugin-*/**/__spec__/**/*.spec.js',
      'plugin-*/**/__spec__/**/*.spec.jsx'
    ],
    setupFiles: ['__spec__/setup/cleanup.ts'],
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
