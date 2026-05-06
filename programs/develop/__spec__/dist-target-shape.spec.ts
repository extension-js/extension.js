// Regression gate: enforce the per-target shape of `dist/` after the ESM
// flip. Runs in <1 s and pins the exact invariant we broke in
// a9153af9 — when the createRequire banner was applied to every emitted
// chunk, the browser-runtime files (preact-refresh-shim,
// minimum-script-file, main-world-bridge, minimum-{chromium,firefox}-file)
// shipped a top-level `import "node:module"`. rspack later bundled those
// wrappers into the user's web-target output and surfaced the cryptic
// "Reading from 'node:module' is not handled by plugins" error, but only
// on the windows-latest/npm CI cell that exercised the React content-dev
// scenario. Checking the artifact directly catches this kind of leak the
// moment `pnpm compile` runs, on every machine.
//
// The two lists below are the contract programs/develop ships:
// - WEB_ENTRIES: emitted as standalone assets that run inside the user's
//   extension at runtime (HTML page, content script, service worker).
//   These MUST contain only browser-safe code.
// - NODE_ENTRIES: emitted for Node — the main library, the preview entry,
//   and rspack loaders that execute in the loader runner at build time.
//   These MAY freely use Node builtins and the createRequire banner.
//
// Update both lists when adding a new entry to rslib.config.ts.

import {describe, it, expect, beforeAll} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const DEVELOP_ROOT = path.resolve(__dirname, '..')
const DIST_DIR = path.join(DEVELOP_ROOT, 'dist')

const WEB_ENTRIES = [
  'preact-refresh-shim',
  'minimum-script-file',
  'main-world-bridge',
  'minimum-chromium-file',
  'minimum-firefox-file'
] as const

const NODE_ENTRIES = [
  'module',
  'preview',
  'resolve-paths-loader',
  'ensure-hmr-for-scripts',
  'feature-scripts-content-script-wrapper'
] as const

// Tokens we do not want to see in a browser-runtime bundle. The banner
// regression hit `node:module` specifically; the rest of the list pins the
// general invariant — a content-script / SW / HTML chunk has no business
// importing Node builtins, regardless of how the import got introduced
// (banner, source edit, plugin, transitive dep).
const FORBIDDEN_NODE_SCHEMES = [
  /\bfrom\s+["']node:[a-z][a-z0-9_-]*["']/i,
  /\brequire\(\s*["']node:[a-z][a-z0-9_-]*["']\s*\)/i
]

// Bare Node-builtin specifiers. We don't want to forbid every word that
// happens to look like a builtin (a content script can absolutely have a
// variable called `path`); we forbid only `import ... from '<builtin>'` and
// `require('<builtin>')` syntactic forms at module scope.
const NODE_BUILTINS = [
  'fs',
  'fs/promises',
  'path',
  'child_process',
  'url',
  'os',
  'crypto',
  'module',
  'http',
  'https',
  'net',
  'tls',
  'stream',
  'events',
  'zlib',
  'process',
  'worker_threads'
]

const FORBIDDEN_BARE_BUILTINS = NODE_BUILTINS.flatMap((id) => {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [
    new RegExp(`\\bfrom\\s+["']${escaped}["']`),
    new RegExp(`\\brequire\\(\\s*["']${escaped}["']\\s*\\)`)
  ]
})

function distFile(stem: string): string {
  // dist/<stem>.mjs is the canonical ESM output (rslib emits .mjs after the
  // ESM flip); the .js sibling is a copy written by write-dist-js-aliases for
  // legacy rspack `resolveLoader.extensions: ['.js', ...]` consumers.
  return path.join(DIST_DIR, `${stem}.mjs`)
}

describe('dist target shape', () => {
  beforeAll(() => {
    if (!fs.existsSync(DIST_DIR)) {
      throw new Error(
        `${DIST_DIR} does not exist. Run \`pnpm --filter extension-develop compile\` ` +
          `before vitest so this regression gate has artifacts to inspect.`
      )
    }
  })

  describe('web-target entries (run in the user extension)', () => {
    for (const stem of WEB_ENTRIES) {
      it(`${stem}.mjs is emitted and contains no Node-only imports`, () => {
        const file = distFile(stem)
        expect(
          fs.existsSync(file),
          `${file} missing — rslib.config.ts WEB lib entry probably renamed/dropped`
        ).toBe(true)

        const source = fs.readFileSync(file, 'utf-8')

        for (const pattern of FORBIDDEN_NODE_SCHEMES) {
          const match = source.match(pattern)
          expect(
            match,
            `${stem}.mjs contains a node: scheme import (${match?.[0]}). ` +
              `Browser-runtime files cannot reference Node builtins; rspack ` +
              `will fail to bundle the user's extension with ` +
              `"Reading from 'node:...' is not handled by plugins".`
          ).toBeNull()
        }

        for (const pattern of FORBIDDEN_BARE_BUILTINS) {
          const match = source.match(pattern)
          expect(
            match,
            `${stem}.mjs imports a bare Node builtin (${match?.[0]}). ` +
              `This is a browser-runtime file; check rslib.config.ts and make ` +
              `sure the entry is in the web-target lib without the createRequire banner.`
          ).toBeNull()
        }
      })
    }
  })

  describe('node-target entries (run in Node at build time)', () => {
    for (const stem of NODE_ENTRIES) {
      it(`${stem}.mjs is emitted`, () => {
        const file = distFile(stem)
        expect(
          fs.existsSync(file),
          `${file} missing — rslib.config.ts NODE lib entry probably renamed/dropped`
        ).toBe(true)
      })
    }

    it('module.mjs carries the createRequire banner', () => {
      // Sanity-check the inverse of the web-target rule: if the banner
      // disappears here, bundled bare `require()` sites in
      // optional-deps-resolver.ts hit ReferenceError at runtime in pure ESM.
      // The exact identifier comes from rslib.config.ts.
      const file = distFile('module')
      const source = fs.readFileSync(file, 'utf-8')
      expect(
        source.startsWith('import { createRequire as __extjsCreateRequire }'),
        'module.mjs is missing the createRequire banner — node-target lib ' +
          'in rslib.config.ts probably regressed; bundled bare require() will ReferenceError.'
      ).toBe(true)
    })
  })
})
