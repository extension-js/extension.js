import {describe, it, expect} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import os from 'os'
import {resolveTranspilePackageDirs, isSubPath} from '../transpile-packages'

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
