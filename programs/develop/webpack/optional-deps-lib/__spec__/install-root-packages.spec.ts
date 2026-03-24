import {afterEach, describe, expect, it} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {resolvePackageFromInstallRoot} from '../install-root-packages'

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true})
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8')
}

function createPnpmStorePackage(
  installRoot: string,
  storeKey: string,
  packageId: string
) {
  const packageDir = path.join(
    installRoot,
    'node_modules',
    '.pnpm',
    storeKey,
    'node_modules',
    ...packageId.split('/')
  )
  fs.mkdirSync(packageDir, {recursive: true})
  writeJson(path.join(packageDir, 'package.json'), {
    name: packageId,
    version: '0.0.0',
    main: 'index.js'
  })
  fs.writeFileSync(path.join(packageDir, 'index.js'), 'module.exports = {}', 'utf8')
}

describe('install-root package resolution', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  it('finds packages inside pnpm store layout', () => {
    const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-opt-root-'))
    tempDirs.push(installRoot)

    createPnpmStorePackage(
      installRoot,
      '@rspack+plugin-react-refresh@1.6.0_react-refresh@0.18.0',
      '@rspack/plugin-react-refresh'
    )

    const resolved = resolvePackageFromInstallRoot(
      '@rspack/plugin-react-refresh',
      installRoot
    )

    expect(resolved).toContain(
      `${path.sep}node_modules${path.sep}.pnpm${path.sep}@rspack+plugin-react-refresh@1.6.0_react-refresh@0.18.0${path.sep}node_modules${path.sep}@rspack${path.sep}plugin-react-refresh${path.sep}index.js`
    )
  })
})
