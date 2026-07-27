import {createHash} from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

const DEVELOP_ROOT = path.resolve(__dirname, '..')
const SHIPPED_DIR = path.join(DEVELOP_ROOT, 'dist', 'contract')

// The canonical contract stays in the extension program's spec tree; the
// develop build copies it into dist so the published package carries it.
const CANONICAL_DIR = path.resolve(
  DEVELOP_ROOT,
  '../extension/__spec__/contract'
)

const WHY =
  'The MCP byte-compares its contract copy against ' +
  'node_modules/extension-develop/dist/contract, so the published package ' +
  'must carry the canonical files from ' +
  'programs/extension/__spec__/contract. The copy step lives in ' +
  'programs/develop/rslib.config.ts (output.copy on the node lib).'

const sha256 = (file: string): string =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex')

const canonicalJsonFiles = fs
  .readdirSync(CANONICAL_DIR)
  .filter((name) => name.endsWith('.json'))
  .sort()

describe('dist/contract ships the canonical machine contract', () => {
  it('emits dist/contract/envelope.schema.json on build', () => {
    expect(canonicalJsonFiles, WHY).toContain('envelope.schema.json')
    expect(
      fs.existsSync(path.join(SHIPPED_DIR, 'envelope.schema.json')),
      `dist/contract/envelope.schema.json is missing after a build. ${WHY}`
    ).toBe(true)
  })

  it('keeps every shipped contract file byte-identical to the canonical', () => {
    for (const name of canonicalJsonFiles) {
      const shipped = path.join(SHIPPED_DIR, name)

      expect(
        fs.existsSync(shipped),
        `dist/contract/${name} is missing after a build. ${WHY}`
      ).toBe(true)

      // String compare first: vitest renders a readable diff for it.
      expect(
        fs.readFileSync(shipped, 'utf8'),
        `dist/contract/${name} drifted from the canonical. ${WHY}`
      ).toBe(fs.readFileSync(path.join(CANONICAL_DIR, name), 'utf8'))

      // Hash second: catches a BOM or a lone carriage return.
      expect(
        sha256(shipped),
        `dist/contract/${name} is not byte-identical to the canonical. ${WHY}`
      ).toBe(sha256(path.join(CANONICAL_DIR, name)))
    }
  })

  it('ships no contract file the canonical does not have', () => {
    expect(
      fs.readdirSync(SHIPPED_DIR).sort(),
      `dist/contract carries a file that is not in the canonical dir. ${WHY}`
    ).toEqual(canonicalJsonFiles)
  })
})
