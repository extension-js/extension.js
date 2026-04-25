import {describe, it, expect, vi} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import os from 'os'
import webpackConfig from '../rspack-config'

const resolveTranspilePackageDirsMock = vi.hoisted(() =>
  vi.fn<(..._args: any[]) => string[]>(() => [])
)
const computeExtensionsToLoadMock = vi.hoisted(() =>
  vi.fn<(..._args: any[]) => string[]>(() => [])
)
// BrowsersPlugin has been removed — browser code is in programs/extension/browsers/

vi.mock('../lib/transpile-packages', async () => {
  const actual = await vi.importActual<
    typeof import('../lib/transpile-packages')
  >('../lib/transpile-packages')
  return {
    ...actual,
    resolveTranspilePackageDirs: resolveTranspilePackageDirsMock
  }
})

vi.mock('../lib/extensions-to-load', async () => {
  const actual = await vi.importActual<
    typeof import('../lib/extensions-to-load')
  >('../lib/extensions-to-load')
  return {
    ...actual,
    computeExtensionsToLoad: computeExtensionsToLoadMock
  }
})

// BrowsersPlugin has been removed — browser code lives in programs/extension/browsers/
// The BrowsersPluginMock is no longer needed.

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
        noBrowser: true
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
        noBrowser: true
      } as any
    )

    const ignored = config.watchOptions?.ignored as RegExp
    expect(
      ignored.test('/repo/node_modules/@workspace/ui/src/button.tsx')
    ).toBe(false)
    expect(ignored.test('/repo/dist/chrome/background.js')).toBe(true)
  })

  it('disables module concatenation in development to avoid react-refresh __webpack_module__ clash', () => {
    // Regression guard: when scope hoisting concatenates a vendor ESM module
    // (e.g. tslib.es6.mjs) into a factory rspack names with CJS convention
    // `(module, __webpack_exports__, ...)`, the @rspack/plugin-react-refresh
    // prologue references `__webpack_module__` — not the factory's parameter —
    // causing `__webpack_module__ is not defined` at runtime for HTML entries
    // (sidebar/newtab/popup) that pull tslib in transitively.
    resolveTranspilePackageDirsMock.mockReturnValue([])
    const projectStructure = createProjectStructure()
    const devConfig = webpackConfig(
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
        noBrowser: true
      } as any
    )
    expect(devConfig.optimization?.concatenateModules).toBe(false)

    const prodConfig = webpackConfig(
      projectStructure as any,
      {
        browser: 'chrome',
        mode: 'production',
        output: {
          clean: false,
          path: path.join(
            path.dirname(projectStructure.manifestPath),
            'dist',
            'chrome'
          )
        },
        noBrowser: true
      } as any
    )
    expect(prodConfig.optimization?.concatenateModules).toBe(true)
  })

  it('passes built-in devtools + theme + user output extensions to computeExtensionsToLoad', () => {
    resolveTranspilePackageDirsMock.mockReturnValue([])
    computeExtensionsToLoadMock.mockReturnValue([
      '/builtins/devtools',
      '/builtins/theme',
      '/project/dist/chrome'
    ])

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
        noBrowser: false
      } as any
    )

    expect(computeExtensionsToLoadMock).toHaveBeenCalledWith(
      expect.any(String),
      'development',
      'chrome',
      '/project/dist/chrome',
      expect.any(Array),
      projectStructure.manifestPath
    )
  })

  it('routes CJS requires through the `require` exports condition', () => {
    // Regression guard for https://github.com/extension-js/extension.js/issues/445.
    // When a project sets `"type": "module"`, packages that ship CJS code (e.g.
    // antd / @ant-design/x) still issue `require()` calls into @babel/runtime.
    // Those runtime helpers expose distinct files per condition; resolving CJS
    // requires through `import` returns an ESM namespace whose default is the
    // helper, which the caller cannot invoke directly — manifesting at runtime
    // as `Uncaught TypeError: _interopRequireDefault is not a function`.
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
        noBrowser: true
      } as any
    )

    const resolve: any = config.resolve
    expect(resolve?.byDependency?.commonjs?.conditionNames).toContain('require')
    expect(resolve?.byDependency?.commonjs?.conditionNames).not.toContain(
      'import'
    )
    expect(resolve?.byDependency?.esm?.conditionNames).toContain('import')
  })
})
