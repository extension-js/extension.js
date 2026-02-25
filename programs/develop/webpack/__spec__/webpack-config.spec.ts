import {describe, it, expect, vi} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import os from 'os'
import webpackConfig from '../webpack-config'

const resolveTranspilePackageDirsMock = vi.hoisted(() => vi.fn(() => []))
const computeExtensionsToLoadMock = vi.hoisted(() => vi.fn(() => []))
const BrowsersPluginMock = vi.hoisted(() => vi.fn())

vi.mock('../webpack-lib/transpile-packages', async () => {
  const actual = await vi.importActual<
    typeof import('../webpack-lib/transpile-packages')
  >('../webpack-lib/transpile-packages')
  return {
    ...actual,
    resolveTranspilePackageDirs: resolveTranspilePackageDirsMock
  }
})

vi.mock('../webpack-lib/extensions-to-load', async () => {
  const actual = await vi.importActual<
    typeof import('../webpack-lib/extensions-to-load')
  >('../webpack-lib/extensions-to-load')
  return {
    ...actual,
    computeExtensionsToLoad: computeExtensionsToLoadMock
  }
})

vi.mock('../plugin-browsers', async () => {
  const actual =
    await vi.importActual<typeof import('../plugin-browsers')>(
      '../plugin-browsers'
    )
  return {
    ...actual,
    BrowsersPlugin: BrowsersPluginMock
  }
})

function createProjectStructure() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-webpack-config-'))
  const packageJsonPath = path.join(root, 'package.json')
  const manifestPath = path.join(root, 'manifest.json')

  fs.writeFileSync(packageJsonPath, JSON.stringify({name: 'demo'}), 'utf-8')
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({manifest_version: 3, name: 'x', version: '1.0.0'}),
    'utf-8'
  )

  return {manifestPath, packageJsonPath}
}

describe('webpack-config transpile packages watch behavior', () => {
  it('keeps node_modules ignored when no transpiled package is detected', () => {
    resolveTranspilePackageDirsMock.mockReturnValue([])
    const projectStructure = createProjectStructure()
    const config = webpackConfig(
      projectStructure as any,
      {
        browser: 'chrome',
        mode: 'development',
        output: {
          clean: false,
          path: path.join(
            path.dirname(projectStructure.manifestPath),
            'dist',
            'chrome'
          )
        },
        noRunner: true
      } as any
    )

    const ignored = config.watchOptions?.ignored as RegExp
    expect(ignored.test('/repo/node_modules/react/index.js')).toBe(true)
  })

  it('does not blanket-ignore node_modules when transpiled packages are auto-detected', () => {
    resolveTranspilePackageDirsMock.mockReturnValue([
      '/repo/node_modules/@workspace/ui'
    ])
    const projectStructure = createProjectStructure()
    const config = webpackConfig(
      projectStructure as any,
      {
        browser: 'chrome',
        mode: 'development',
        output: {
          clean: false,
          path: path.join(
            path.dirname(projectStructure.manifestPath),
            'dist',
            'chrome'
          )
        },
        noRunner: true
      } as any
    )

    const ignored = config.watchOptions?.ignored as RegExp
    expect(
      ignored.test('/repo/node_modules/@workspace/ui/src/button.tsx')
    ).toBe(false)
    expect(ignored.test('/repo/dist/chrome/background.js')).toBe(true)
  })

  it('passes built-in devtools + theme + user output extensions to BrowsersPlugin', () => {
    resolveTranspilePackageDirsMock.mockReturnValue([])
    computeExtensionsToLoadMock.mockReturnValue([
      '/builtins/devtools',
      '/builtins/theme',
      '/project/dist/chrome'
    ])
    BrowsersPluginMock.mockClear()

    const projectStructure = createProjectStructure()
    webpackConfig(
      projectStructure as any,
      {
        browser: 'chrome',
        mode: 'development',
        output: {
          clean: false,
          path: '/project/dist/chrome'
        },
        noRunner: false
      } as any
    )

    expect(computeExtensionsToLoadMock).toHaveBeenCalledWith(
      expect.any(String),
      'development',
      'chrome',
      '/project/dist/chrome',
      expect.any(Array)
    )
    expect(BrowsersPluginMock).toHaveBeenCalledWith(
      expect.objectContaining({
        extension: [
          '/builtins/devtools',
          '/builtins/theme',
          '/project/dist/chrome'
        ]
      })
    )
  })
})
