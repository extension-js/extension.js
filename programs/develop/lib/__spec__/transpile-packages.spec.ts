import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {
  createNodeModulesExclude,
  resolveTranspilePackageDirs
} from '../transpile-packages'

const makeTempFolder = trackTempFolders()

describe('transpile-packages', () => {
  it('resolves package directories from project node_modules', () => {
    const projectRoot = makeTempFolder('extjs-transpile-')
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
    const projectRoot = makeTempFolder('extjs-transpile-')
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
    const projectRoot = makeTempFolder('extjs-transpile-')
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

  it('resolves package root when package.json is not exported', () => {
    const projectRoot = makeTempFolder('extjs-transpile-')
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

  it('resolves each package dir and module folder once for a large graph', () => {
    const root = fs.realpathSync(makeTempFolder('extjs-exclude-'))
    const store = path.join(root, 'node_modules', '.pnpm')
    const workspaceNames = ['core', 'shared', 'ui', 'web', 'recorder']
    const packageDirs: string[] = []

    // A workspace dependency is a link in node_modules to a sibling package,
    // and the predicate is handed both spellings of it.
    for (const name of workspaceNames) {
      const realDir = path.join(root, 'packages', name)
      const linkDir = path.join(root, 'node_modules', '@workspace', name)
      fs.mkdirSync(path.join(realDir, 'node_modules', 'dep', 'src'), {
        recursive: true
      })

      fs.mkdirSync(path.dirname(linkDir), {recursive: true})
      fs.symlinkSync(realDir, linkDir, 'junction')
      packageDirs.push(linkDir, realDir)
    }

    const folders: string[] = []

    for (let index = 0; index < 300; index++) {
      const folder = path.join(store, `pkg-${index}`, 'node_modules', 'lib')
      fs.mkdirSync(folder, {recursive: true})
      folders.push(folder)
    }

    const prebuilt = folders.flatMap((folder) =>
      Array.from({length: 10}, (_, file) => path.join(folder, `m${file}.js`))
    )
    const transpiled = workspaceNames.flatMap((name) => [
      path.join(
        root,
        'node_modules',
        '@workspace',
        name,
        'node_modules/dep/src/a.ts'
      ),
      path.join(root, 'packages', name, 'node_modules/dep/src/b.ts')
    ])

    const realpath = vi.spyOn(fs.realpathSync, 'native')

    try {
      const exclude = createNodeModulesExclude(packageDirs)

      // The bundler asks once per rule that carries the exclude.
      for (let rule = 0; rule < 3; rule++) {
        for (const resource of prebuilt) {
          expect(exclude(resource)).toBe(true)
        }

        for (const resource of transpiled) {
          expect(exclude(resource)).toBe(false)
        }
      }

      expect(exclude(path.join(root, 'src', 'index.ts'))).toBe(false)

      const moduleFolders = folders.length + transpiled.length
      expect(prebuilt.length).toBe(3000)
      expect(realpath.mock.calls.length).toBeLessThanOrEqual(
        packageDirs.length + moduleFolders
      )
    } finally {
      realpath.mockRestore()
    }
  })

  it('reads no folder from disk when nothing is transpiled', () => {
    const realpath = vi.spyOn(fs.realpathSync, 'native')

    try {
      const exclude = createNodeModulesExclude([])

      expect(exclude('/repo/node_modules/react/index.js')).toBe(true)
      expect(exclude('/repo/src/index.ts')).toBe(false)
      expect(realpath).not.toHaveBeenCalled()
    } finally {
      realpath.mockRestore()
    }
  })
})
