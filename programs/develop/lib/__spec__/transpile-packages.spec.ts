import * as fs from 'node:fs'
import os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {isSubPath, resolveTranspilePackageDirs} from '../transpile-packages'

describe('transpile-packages', () => {
  it('resolves package directories from project node_modules', () => {
    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'extjs-transpile-')
    )
    fs.writeFileSync(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({name: 'app'}),
      'utf-8'
    )
    const packageDir = path.join(
      projectRoot,
      'node_modules',
      '@workspace',
      'ui'
    )
    fs.mkdirSync(packageDir, {recursive: true})
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({name: '@workspace/ui', version: '0.0.0'}),
      'utf-8'
    )

    const dirs = resolveTranspilePackageDirs(projectRoot, ['@workspace/ui'])
    expect(
      dirs.some((entry) => entry.endsWith('/node_modules/@workspace/ui'))
    ).toBe(true)
  })

  it('returns empty array for missing packages', () => {
    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'extjs-transpile-')
    )
    fs.writeFileSync(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({name: 'app'}),
      'utf-8'
    )

    const dirs = resolveTranspilePackageDirs(projectRoot, [
      '@workspace/missing'
    ])
    expect(dirs).toEqual([])
  })

  it('auto-includes workspace dependencies from package.json', () => {
    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'extjs-transpile-')
    )
    fs.writeFileSync(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({
        name: 'app',
        dependencies: {'@workspace/ui': 'workspace:*'}
      }),
      'utf-8'
    )
    const packageDir = path.join(
      projectRoot,
      'node_modules',
      '@workspace',
      'ui'
    )
    fs.mkdirSync(packageDir, {recursive: true})
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({name: '@workspace/ui', version: '0.0.0'}),
      'utf-8'
    )

    const dirs = resolveTranspilePackageDirs(projectRoot)
    expect(
      dirs.some((entry) => entry.endsWith('/node_modules/@workspace/ui'))
    ).toBe(true)
  })

  it('checks whether a path belongs to a package root', () => {
    expect(
      isSubPath(
        '/repo/node_modules/@workspace/ui/src/button.tsx',
        '/repo/node_modules/@workspace/ui'
      )
    ).toBe(true)
    expect(
      isSubPath(
        '/repo/node_modules/react/index.js',
        '/repo/node_modules/@workspace/ui'
      )
    ).toBe(false)
  })

  it('matches a resource reachable through a symlinked package dir', () => {
    const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-subpath-'))
    )
    const realPkg = path.join(root, 'real-pkg', 'src')
    fs.mkdirSync(realPkg, {recursive: true})
    const resource = path.join(realPkg, 'index.ts')
    fs.writeFileSync(resource, 'x')

    const linkedPkgRoot = path.join(root, 'linked-pkg')
    fs.symlinkSync(path.join(root, 'real-pkg'), linkedPkgRoot, 'junction')
    const linkedResource = path.join(linkedPkgRoot, 'src', 'index.ts')

    expect(isSubPath(linkedResource, path.join(root, 'real-pkg'))).toBe(true)
    fs.rmSync(root, {recursive: true, force: true})
  })

  it('resolves package root when package.json is not exported', () => {
    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'extjs-transpile-')
    )
    fs.writeFileSync(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({
        name: 'app',
        dependencies: {'@workspace/ui': 'workspace:*'}
      }),
      'utf-8'
    )
    const packageDir = path.join(
      projectRoot,
      'node_modules',
      '@workspace',
      'ui'
    )
    fs.mkdirSync(path.join(packageDir, 'src'), {recursive: true})
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({
        name: '@workspace/ui',
        version: '0.0.0',
        exports: {
          '.': './src/index.ts'
        }
      }),
      'utf-8'
    )
    fs.writeFileSync(
      path.join(packageDir, 'src', 'index.ts'),
      'export {}',
      'utf-8'
    )

    const dirs = resolveTranspilePackageDirs(projectRoot)
    expect(
      dirs.some((entry) => entry.endsWith('/node_modules/@workspace/ui'))
    ).toBe(true)
  })
})
