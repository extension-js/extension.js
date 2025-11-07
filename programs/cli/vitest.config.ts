import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Run tests in forked processes to avoid worker RPC timeouts in CI
    pool: 'forks',
    // Increase timeouts to accommodate slower CI environments and long-running integration tests
    testTimeout: 120_000,
    hookTimeout: 120_000,
    teardownTimeout: 120_000,
    include: [
      'cli-lib/**/__spec__/**/*.spec.ts',
      '__spec__/(dynamic-install|cache-reuse-offline|dlx-pnpm|telemetry-default).spec.ts'
    ],
    sequence: {concurrent: false},
    allowOnly: !process.env.CI
  }
})
