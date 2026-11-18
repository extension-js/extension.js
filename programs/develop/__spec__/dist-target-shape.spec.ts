import * as fs from 'node:fs'
import * as path from 'node:path'
import {beforeAll, describe, expect, it} from 'vitest'

const DEVELOP_ROOT = path.resolve(__dirname, '..')
const DIST_DIR = path.join(DEVELOP_ROOT, 'dist')

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

// Walks dist because the offender is usually a split chunk, not a named entry.
function emittedEsmFiles(dir: string = DIST_DIR): string[] {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return emittedEsmFiles(full)

    return entry.name.endsWith('.mjs') ? [full] : []
  })
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

  // Node resolves a bare `path` and `node:path` to the same builtin, so this
  // only ever breaks off Node, which is why it reached a release unnoticed.
  describe('every emitted ESM file (the CLI runs on Deno too)', () => {
    it('imports no Node builtin without the node: prefix', () => {
      const offenders = emittedEsmFiles().flatMap((file) =>
        FORBIDDEN_BARE_BUILTINS.flatMap((pattern) => {
          const match = fs.readFileSync(file, 'utf-8').match(pattern)

          return match ? [`${path.relative(DIST_DIR, file)}: ${match[0]}`] : []
        })
      )

      expect(
        offenders,
        `These emitted files import a Node builtin as a bare specifier:\n` +
          `${offenders.join('\n')}\n` +
          `Deno reads a bare builtin in ESM as a package specifier and refuses ` +
          `it ("Import \\"path\\" not a dependency"), so the CLI dies on Deno ` +
          `before it compiles anything. rslib externalizes the specifier exactly ` +
          `as written, so fix the source import to node:<builtin>.`
      ).toEqual([])
    })
  })
})
