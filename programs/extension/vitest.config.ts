//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {readFileSync} from 'node:fs'
import {defineConfig, type Plugin} from 'vitest/config'

// Vitest caches each transform with its imports already resolved, keyed on the
// importer alone. A linked package's manifest picks those paths, so key on it.
function keyModuleCacheOnLinkedManifests(): Plugin {
  const read = (file: string) =>
    readFileSync(new URL(file, import.meta.url), 'utf8')
  const own = JSON.parse(read('./package.json')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const linked = Object.entries({...own.devDependencies, ...own.dependencies})
    .filter(([, range]) => range.startsWith('workspace:'))
    .map(([name]) => name)
    .sort()
  const manifests = linked
    .map((name) => read(`./node_modules/${name}/package.json`))
    .join('\n')

  return {
    name: 'extension:key-module-cache-on-linked-manifests',
    configureVitest({defineCacheKeyGenerator}) {
      defineCacheKeyGenerator(() => manifests)
    }
  }
}

export default defineConfig({
  plugins: [keyModuleCacheOnLinkedManifests()],
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
      'browsers/__spec__/**/*.spec.ts',
      'commands/__spec__/**/*.spec.ts'
    ],
    // One temp folder for the whole run, removed when the run ends.
    globalSetup: ['../../scripts/lib/spec-temp-folder.mjs'],
    setupFiles: ['__spec__/setup/env.ts'],
    sequence: {concurrent: false},
    allowOnly: !process.env.CI
  }
})
