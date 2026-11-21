import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import {rspack} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {sourceMapModuleName} from '../source-map-module-names'

const makeTempFolder = trackTempFolders()

const develop = path.resolve('/install/node_modules/extension-develop')
const project = path.resolve('/work/my-extension')

function nameOf(absoluteResourcePath: string, resourcePath: string) {
  return sourceMapModuleName(
    develop,
    project
  )({absoluteResourcePath, resourcePath, namespace: 'my-extension'})
}

describe('source map module names', () => {
  it('names a file of Extension.js by its place in the package', () => {
    expect(
      nameOf(
        path.join(develop, 'dist', 'minimum-script-file.mjs'),
        '../../install/node_modules/extension-develop/dist/minimum-script-file.mjs'
      )
    ).toBe('webpack://my-extension/extension.js/dist/minimum-script-file.mjs')
  })

  it('keeps the default name for a project file and a runtime module', () => {
    expect(nameOf(path.join(project, 'bg.js'), './bg.js')).toBe(
      'webpack://my-extension/./bg.js'
    )

    expect(nameOf('webpack/bootstrap', 'webpack/bootstrap')).toBe(
      'webpack://my-extension/webpack/bootstrap'
    )
  })

  it('keeps the default name for a workspace file outside the project', () => {
    const shared = path.resolve('/work/shared/util.js')

    expect(nameOf(shared, '../shared/util.js')).toBe(
      'webpack://my-extension/../shared/util.js'
    )
  })

  it('keeps the default name for a project that sits inside the package', () => {
    const nested = path.join(develop, 'fixture')
    const name = sourceMapModuleName(
      develop,
      nested
    )({
      absoluteResourcePath: path.join(nested, 'bg.js'),
      resourcePath: './bg.js',
      namespace: 'fixture'
    })

    expect(name).toBe('webpack://fixture/./bg.js')
  })

  // The dev server client and the hot runtime are installed beside the
  // package, not in it, and no lookup from the project reaches them.
  it('names a dependency of Extension.js by its package', () => {
    const client = path.resolve(
      '/install/node_modules/@rspack/dev-server/client/index.js'
    )

    expect(
      nameOf(
        client,
        '../../install/node_modules/@rspack/dev-server/client/index.js'
      )
    ).toBe(
      'webpack://my-extension/extension.js/node_modules/@rspack/dev-server/client/index.js'
    )
  })

  it('names it by its package under a nested store folder too', () => {
    const hot = path.resolve(
      '/install/node_modules/.pnpm/@rspack+core@2.0.0/node_modules/@rspack/core/hot/log.js'
    )

    expect(nameOf(hot, '../../install/x')).toBe(
      'webpack://my-extension/extension.js/node_modules/@rspack/core/hot/log.js'
    )
  })

  // A hoisted install serves the project and Extension.js alike, so what
  // sits there is the project's dependency and keeps the default name.
  it('keeps the default name for a package the project can import', () => {
    const shared = path.resolve('/work/node_modules/react/index.js')
    const name = sourceMapModuleName(
      path.resolve('/work/node_modules/extension-develop'),
      project
    )({
      absoluteResourcePath: shared,
      resourcePath: '../node_modules/react/index.js',
      namespace: 'my-extension'
    })

    expect(name).toBe('webpack://my-extension/../node_modules/react/index.js')
  })

  it('keeps the default name for a package neither install holds', () => {
    const elsewhere = path.resolve('/other/node_modules/left-pad/index.js')

    expect(
      nameOf(elsewhere, '../../other/node_modules/left-pad/index.js')
    ).toBe('webpack://my-extension/../../other/node_modules/left-pad/index.js')
  })
})

// The hot runtime a dev session adds to every entry, resolved the way the
// session resolves it: from this package, not from the project.
describe('source map module names in a real compile', () => {
  const developRoot = path.resolve(__dirname, '..', '..')

  async function sourcesOf(root: string): Promise<string[]> {
    const hotRuntime = createRequire(
      path.join(developRoot, 'package.json')
    ).resolve('@rspack/core/hot/log.js')

    fs.writeFileSync(path.join(root, 'own.js'), 'export const own = 1\n')
    fs.writeFileSync(
      path.join(root, 'entry.js'),
      `import ${JSON.stringify(hotRuntime)}\nimport './own.js'\n`
    )

    const compiler = rspack({
      mode: 'development',
      devtool: 'source-map',
      context: root,
      entry: './entry.js',
      output: {
        path: path.join(root, 'out'),
        filename: 'main.js',
        uniqueName: 'project',
        devtoolModuleFilenameTemplate: sourceMapModuleName(developRoot, root)
      }
    })

    await new Promise<void>((resolve, reject) => {
      compiler.run((error, stats) => {
        const failure = error || stats?.compilation.errors[0]

        compiler.close(() => (failure ? reject(failure) : resolve()))
      })
    })

    const map = JSON.parse(
      fs.readFileSync(path.join(root, 'out', 'main.js.map'), 'utf8')
    ) as {sources: string[]}

    return map.sources
  }

  it('names no file by a path that climbs out of the project', async () => {
    const sources = await sourcesOf(
      fs.realpathSync.native(makeTempFolder('extjs-map-names-'))
    )

    expect(sources).toContain(
      'webpack://project/extension.js/node_modules/@rspack/core/hot/log.js'
    )

    expect(sources).toContain('webpack://project/./own.js')
    expect(sources.filter((source) => source.includes('../'))).toEqual([])
  })
})
