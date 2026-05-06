// Real-rspack regression gate for the content-script + browser-shim build
// path — the part of the graph that pulls in
// `feature-scripts-content-script-wrapper` (loader) plus the browser-runtime
// shims (preact-refresh-shim, main-world-bridge, minimum-script-file). The
// bug that motivated this spec (a9153af9) only surfaced once a real user
// extension with a content_scripts entry was actually compiled — every
// other layer (mocked command-build.spec.ts, lighter assert-canary-one-run
// templates, develop unit suites) was blind to it.
//
// Spec is heavier than the rest of __spec__ because it runs rspack on a
// fixture (~5 s warm). It lives in the develop test suite so contributors
// hit it on `pnpm --filter extension-develop test`, and a fresh regression
// fails at PR time, not at the CI matrix tail. We keep the fixture
// React-free on purpose: the regression is about the wrapper graph, not
// about React; using plain JS keeps the spec offline (no react dep) and
// fast.

import {describe, it, expect, beforeAll, afterAll} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const FIXTURE_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-content-script-')
)

function writeFixture() {
  fs.mkdirSync(path.join(FIXTURE_ROOT, 'src', 'content'), {recursive: true})

  fs.writeFileSync(
    path.join(FIXTURE_ROOT, 'package.json'),
    JSON.stringify(
      {
        private: true,
        name: 'extjs-build-content-script-spec',
        version: '0.0.0',
        type: 'module'
      },
      null,
      2
    )
  )

  fs.writeFileSync(
    path.join(FIXTURE_ROOT, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec — Content Script',
        version: '1.0.0',
        content_scripts: [
          {
            matches: ['https://example.com/*'],
            js: ['src/content/scripts.js'],
            run_at: 'document_idle'
          }
        ]
      },
      null,
      2
    )
  )

  // Plain JS keeps the spec offline (no React dep). The wrapper code path
  // and browser-shim graph are exercised the same way.
  fs.writeFileSync(
    path.join(FIXTURE_ROOT, 'src', 'content', 'scripts.js'),
    [
      'export default function main() {',
      "  const host = document.createElement('div')",
      "  host.id = 'extjs-build-spec-content-root'",
      '  document.documentElement.append(host)',
      '  return () => host.remove()',
      '}',
      ''
    ].join('\n')
  )
}

beforeAll(() => {
  writeFixture()
}, 30_000)

afterAll(() => {
  fs.rmSync(FIXTURE_ROOT, {recursive: true, force: true})
})

describe('build: content script (real rspack)', () => {
  it(
    'compiles the user extension without the node:module / web-target leak',
    async () => {
      // Heavy module — only loaded inside this spec to keep the rest of the
      // suite fast. extensionBuild calls the same pipeline a real
      // `extension build` invocation does (rspack + content-script wrapper +
      // browser shims), so a regression here mirrors the smoke breakage.
      const {extensionBuild} = await import('../command-build')

      const previousAuthorMode = process.env.EXTENSION_AUTHOR_MODE
      const previousVitest = process.env.VITEST
      // VITEST=true flips extensionBuild's `shouldExitOnError` to false, so a
      // bundler error rejects the promise instead of killing the test process.
      process.env.VITEST = 'true'
      // Suppress the noisy author-mode banner; we still surface real
      // bundler errors via stats.
      delete process.env.EXTENSION_AUTHOR_MODE

      try {
        const summary = await extensionBuild(FIXTURE_ROOT, {
          browser: 'chrome',
          silent: true,
          install: false,
          mode: 'development',
          exitOnError: false
        } as any)

        // Build must produce assets and zero compile errors. The original
        // regression manifested as `errors_count > 0` with the message
        // 'Reading from "node:module" is not handled by plugins' — failing
        // here means a node-only import sneaked into a browser-target chunk.
        expect(summary.errors_count).toBe(0)
        expect(summary.total_assets).toBeGreaterThan(0)
      } finally {
        if (previousAuthorMode === undefined) {
          delete process.env.EXTENSION_AUTHOR_MODE
        } else {
          process.env.EXTENSION_AUTHOR_MODE = previousAuthorMode
        }
        if (previousVitest === undefined) {
          delete process.env.VITEST
        } else {
          process.env.VITEST = previousVitest
        }
      }

      // Sanity-check the asset graph: the wrapper-driven content script
      // bundle should be on disk and the manifest should reference it.
      const distDir = path.join(FIXTURE_ROOT, 'dist', 'chrome')
      const manifest = JSON.parse(
        fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
      )
      const contentJs: string[] = manifest.content_scripts?.[0]?.js ?? []
      expect(contentJs.length).toBeGreaterThan(0)
      for (const rel of contentJs) {
        expect(
          fs.existsSync(path.join(distDir, rel)),
          `${rel} declared by manifest but missing from ${distDir}`
        ).toBe(true)
      }
    },
    120_000
  )
})
