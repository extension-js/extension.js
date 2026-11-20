//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {defineConfig} from 'vitest/config'
import {droppedVitestFiltersMessage} from '../../scripts/lib/vitest-filter-args.mjs'

// Vitest drops a filter written after `--` or right after `-u`, and a
// direct call would then start the whole suite. pnpm test rewrites both.
const dropped = droppedVitestFiltersMessage(process.argv.slice(2))

if (dropped) throw new Error(dropped)

// A *.remote.spec.ts file is the only place a spec may reach the real examples
// catalog, and it stays out of the gate: `pnpm test:remote` runs those.
const runsRemote = Boolean(process.env.EXTENSION_TEST_REMOTE)

export default defineConfig({
  test: {
    pool: 'forks',
    globals: true,
    environment: 'node',
    include: ['**/*.spec.ts'],
    exclude: [
      'dist/**',
      'node_modules/**',
      ...(runsRemote ? [] : ['**/*.remote.spec.ts'])
    ],
    // One temp folder for the whole run, removed when the run ends.
    globalSetup: ['../../scripts/lib/spec-temp-folder.mjs'],
    setupFiles: ['./__spec__/forbid-network.ts'],
    // A run started outside a package manager names none, and every create
    // in it would then start the real npm to ask its version.
    env: {
      npm_config_user_agent:
        process.env.npm_config_user_agent || 'npm/11.11.0 node/v22.12.0'
    },
    // A test that runs no assertion fails instead of passing empty.
    expect: {requireAssertions: true},
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'coverage/**',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/messages.ts',
        '**/rslib.config.*',
        '**/vitest.config.*',
        '**/README.md',
        '**/CHANGELOG.md',
        '**/tsconfig.json'
      ]
    }
  }
})
