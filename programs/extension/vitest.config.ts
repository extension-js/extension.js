//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {defineConfig} from 'vitest/config'

export default defineConfig({
  resolve: {
    conditions: ['development', 'node', 'import', 'default']
  },
  test: {
    globals: true,
    environment: 'node',
    // Run tests in forked processes to avoid worker RPC timeouts in CI
    pool: 'forks',
    // Ensure a single worker to reduce RPC pressure/timeouts in CI
    maxWorkers: 1,
    // Increase timeouts to accommodate slower CI environments and long-running integration tests
    testTimeout: 120_000,
    hookTimeout: 120_000,
    teardownTimeout: 120_000,
    // '__spec__/*.spec.ts' is not recursive, so every subdirectory needs its
    // own entry or its specs are silently collected as zero and report green.
    include: [
      'helpers/**/__spec__/**/*.spec.ts',
      '__spec__/*.spec.ts',
      '__spec__/exec/**/*.spec.ts',
      '__spec__/contract/**/*.spec.ts',
      'browsers/__spec__/**/*.spec.ts'
    ],
    setupFiles: ['__spec__/setup/env.ts'],
    sequence: {concurrent: false},
    allowOnly: !process.env.CI
  }
})
