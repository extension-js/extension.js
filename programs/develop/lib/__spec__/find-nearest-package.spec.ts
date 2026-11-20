import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {findNearestPackageJsonSync, validatePackageJson} from '../package-json'

const makeTempFolder = trackTempFolders()

function makeTempDir(prefix: string) {
  return makeTempFolder(prefix)
}

afterEach(() => {})

describe('find-nearest-package', () => {
  it('findNearestPackageJsonSync finds nearest package.json upward', () => {
    const root = makeTempDir('extjs-nearest-')
    const parent = path.join(root, 'a')
    const child = path.join(parent, 'b', 'c')
    fs.mkdirSync(child, {recursive: true})
    const pkgPath = path.join(parent, 'package.json')
    fs.writeFileSync(pkgPath, JSON.stringify({name: 'a'}))
    const manifestDir = path.join(child)
    fs.writeFileSync(path.join(manifestDir, 'manifest.json'), '{}')

    const found = findNearestPackageJsonSync(
      path.join(manifestDir, 'manifest.json')
    )
    expect(found).toBe(pkgPath)
  })

  it('answers null for a path it cannot walk and prints no raw error', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      expect(findNearestPackageJsonSync(undefined as never)).toBeNull()
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('validatePackageJson is false for a missing file and refuses invalid JSON', () => {
    const tmp = makeTempDir('extjs-validate-')
    const missing = path.join(tmp, 'missing.json')
    expect(validatePackageJson(missing)).toBe(false)
    const invalid = path.join(tmp, 'package.json')
    fs.writeFileSync(invalid, '{invalid')
    expect(() => validatePackageJson(invalid)).toThrow(
      expect.objectContaining({code: 'E_PACKAGE_JSON_INVALID'})
    )

    fs.writeFileSync(invalid, JSON.stringify({name: 'ok'}))
    expect(validatePackageJson(invalid)).toBe(true)
  })
})
