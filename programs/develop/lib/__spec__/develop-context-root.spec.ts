import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {findExtensionDevelopRoot} from '../develop-context'

let tmp: string
const savedEnv = process.env.EXTENSION_DEVELOP_ROOT

const makePackage = (dir: string, name: string) => {
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({name}))

  return fs.realpathSync(dir)
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'develop-root-')))

  delete process.env.EXTENSION_DEVELOP_ROOT
})

afterEach(() => {
  fs.rmSync(tmp, {recursive: true, force: true})
  if (savedEnv === undefined) delete process.env.EXTENSION_DEVELOP_ROOT
  else process.env.EXTENSION_DEVELOP_ROOT = savedEnv
})

describe('findExtensionDevelopRoot', () => {
  it('finds the package from the flat shipped dist folder', () => {
    const root = makePackage(
      path.join(tmp, 'node_modules', 'extension-develop'),
      'extension-develop'
    )
    const dist = path.join(root, 'dist')
    fs.mkdirSync(dist)

    expect(findExtensionDevelopRoot(dist)).toBe(root)
  })

  it('finds the package from a nested dist/lib folder', () => {
    const root = makePackage(path.join(tmp, 'develop'), 'extension-develop')
    const lib = path.join(root, 'dist', 'lib')
    fs.mkdirSync(lib, {recursive: true})

    expect(findExtensionDevelopRoot(lib)).toBe(root)
  })

  it('skips a parent package with another name', () => {
    makePackage(path.join(tmp, 'programs'), 'extension-workspace')
    const dist = path.join(tmp, 'programs', 'dist')
    fs.mkdirSync(dist)

    expect(findExtensionDevelopRoot(dist)).toBeNull()
  })

  it('honors EXTENSION_DEVELOP_ROOT', () => {
    const root = makePackage(path.join(tmp, 'override'), 'extension-develop')
    process.env.EXTENSION_DEVELOP_ROOT = root

    expect(findExtensionDevelopRoot(path.join(tmp, 'elsewhere'))).toBe(root)
  })

  it('ignores an EXTENSION_DEVELOP_ROOT that is not the package', () => {
    process.env.EXTENSION_DEVELOP_ROOT = makePackage(
      path.join(tmp, 'wrong'),
      'something-else'
    )

    const root = makePackage(path.join(tmp, 'develop'), 'extension-develop')
    const dist = path.join(root, 'dist')
    fs.mkdirSync(dist)

    expect(findExtensionDevelopRoot(dist)).toBe(root)
  })
})
