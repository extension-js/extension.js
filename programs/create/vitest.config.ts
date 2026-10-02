//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {defineConfig} from 'vitest/config'

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
    setupFiles: ['./__spec__/forbid-network.ts'],
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
