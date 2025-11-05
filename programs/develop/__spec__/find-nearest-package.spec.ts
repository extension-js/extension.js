import {describe, it, expect, afterEach} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import os from 'os'
import {
  findNearestPackageJson,
  validatePackageJson
} from '../webpack/webpack-lib/package-json'

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return dir
}

afterEach(() => {
  // noop: OS tmp dirs are auto-cleaned; leave artifacts for failure debugging
})

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
    // valid
    fs.writeFileSync(invalid, JSON.stringify({name: 'ok'}))
    expect(validatePackageJson(invalid)).toBe(true)
  })
})
