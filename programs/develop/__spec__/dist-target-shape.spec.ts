import * as fs from 'node:fs'
import * as path from 'node:path'
import {beforeAll, describe, expect, it} from 'vitest'

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
  'ensure-hmr-for-scripts',
  'feature-scripts-content-script-wrapper',
  'feature-scripts-classic-concat-loader'
] as const

const FORBIDDEN_NODE_SCHEMES = [
  /\bfrom\s+["']node:[a-z][a-z0-9_-]*["']/i,
  /\brequire\(\s*["']node:[a-z][a-z0-9_-]*["']\s*\)/i
]

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
          `${file} missing, rslib.config.ts WEB lib entry probably renamed/dropped`
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
          `${file} missing, rslib.config.ts NODE lib entry probably renamed/dropped`
        ).toBe(true)
      })
    }

    it('module.mjs carries the createRequire banner', () => {
      const file = distFile('module')
      const source = fs.readFileSync(file, 'utf-8')
      expect(
        source.startsWith('import { createRequire as __extjsCreateRequire }'),
        'module.mjs is missing the createRequire banner, node-target lib ' +
          'in rslib.config.ts probably regressed; bundled bare require() will ReferenceError.'
      ).toBe(true)
    })
  })
})
