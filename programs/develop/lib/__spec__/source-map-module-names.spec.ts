import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {sourceMapModuleName} from '../source-map-module-names'

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
        path.join(develop, 'dist', 'preact-refresh-shim.mjs'),
        '../../install/node_modules/extension-develop/dist/preact-refresh-shim.mjs'
      )
    ).toBe('webpack://my-extension/extension.js/dist/preact-refresh-shim.mjs')
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
})
