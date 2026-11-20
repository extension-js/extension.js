// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {defineConfig} from 'vitest/config'
import {droppedVitestFiltersMessage} from '../../scripts/lib/vitest-filter-args.mjs'

// Vitest drops a filter written after `--` or right after `-u`, and a
// direct call would then start the whole suite. pnpm test rewrites both.
const dropped = droppedVitestFiltersMessage(process.argv.slice(2))

if (dropped) throw new Error(dropped)

// Every fixture lives in its own temp folder, so files run side by side. On
// macOS two watch sessions closing at once block their processes for minutes.
const SPEC_WORKERS =
  process.platform === 'darwin' ? 1 : process.platform === 'win32' ? 2 : 3

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    maxWorkers: SPEC_WORKERS,
    testTimeout: 30000,
    hookTimeout: 45000,
    include: [
      '__spec__/**/*.spec.ts',
      '__spec__/**/*.spec.tsx',
      '__spec__/**/*.spec.js',
      '__spec__/**/*.spec.jsx',
      'dev-server/**/__spec__/**/*.spec.ts',
      'lib/**/__spec__/**/*.spec.ts',
      'plugin-*/**/__spec__/**/*.spec.ts',
      'plugin-*/**/__spec__/**/*.spec.tsx',
      'plugin-*/**/__spec__/**/*.spec.js',
      'plugin-*/**/__spec__/**/*.spec.jsx'
    ],
    // One temp folder for the whole run, removed when the run ends.
    globalSetup: [
      '../../scripts/lib/spec-temp-folder.mjs',
      '__spec__/setup/leftover-folders.ts'
    ],
    // The guard fails a spec whose mock leaves out an export the code reads.
    setupFiles: [
      '__spec__/setup/quiet-output.ts',
      '__spec__/setup/mock-export-guard.ts'
    ],
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
