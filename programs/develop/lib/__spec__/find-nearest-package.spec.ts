import * as fs from 'node:fs'
import os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {findNearestPackageJson, validatePackageJson} from '../package-json'

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return dir
}

afterEach(() => {})

describe('find-nearest-package', () => {
  it('findNearestPackageJson finds nearest package.json upward', async () => {
    const root = makeTempDir('extjs-nearest-')
    const parent = path.join(root, 'a')
    const child = path.join(parent, 'b', 'c')
    fs.mkdirSync(child, {recursive: true})
    const pkgPath = path.join(parent, 'package.json')
    fs.writeFileSync(pkgPath, JSON.stringify({name: 'a'}))
    const manifestDir = path.join(child)
    fs.writeFileSync(path.join(manifestDir, 'manifest.json'), '{}')

    const found = await findNearestPackageJson(
      path.join(manifestDir, 'manifest.json')
    )
    expect(found).toBe(pkgPath)
  })

  it('validatePackageJson returns false for missing or invalid JSON', () => {
    const tmp = makeTempDir('extjs-validate-')
    const missing = path.join(tmp, 'missing.json')
    expect(validatePackageJson(missing)).toBe(false)
    const invalid = path.join(tmp, 'package.json')
    fs.writeFileSync(invalid, '{invalid')
    expect(validatePackageJson(invalid)).toBe(false)
    fs.writeFileSync(invalid, JSON.stringify({name: 'ok'}))
    expect(validatePackageJson(invalid)).toBe(true)
  })
})
