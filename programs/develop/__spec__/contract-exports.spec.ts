import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

const developRoot = path.resolve(__dirname, '..')
const canonicalDir = path.resolve(developRoot, '../extension/__spec__/contract')
const selfRequire = createRequire(path.join(developRoot, '__spec__', 'x.js'))

const canonicalJsonFiles = fs
  .readdirSync(canonicalDir)
  .filter((name) => name.endsWith('.json'))
  .sort()

describe('the shipped machine contract is reachable by specifier', () => {
  it('maps ./contract/* to ./dist/contract/*', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(developRoot, 'package.json'), 'utf8')
    )
    expect(packageJson.exports['./contract/*']).toBe('./dist/contract/*')
  })

  it('resolves every canonical contract file', () => {
    expect(canonicalJsonFiles.length).toBeGreaterThan(0)
    for (const name of canonicalJsonFiles) {
      const resolved = selfRequire.resolve(`extension-develop/contract/${name}`)
      expect(resolved).toBe(path.join(developRoot, 'dist', 'contract', name))
      expect(fs.existsSync(resolved)).toBe(true)
    }
  })

  it('resolves to JSON bytes identical to the canonical files', () => {
    for (const name of canonicalJsonFiles) {
      const resolved = selfRequire.resolve(`extension-develop/contract/${name}`)
      const shipped = fs.readFileSync(resolved, 'utf8')
      expect(() => JSON.parse(shipped)).not.toThrow()
      expect(shipped).toBe(
        fs.readFileSync(path.join(canonicalDir, name), 'utf8')
      )
    }
  })
})
