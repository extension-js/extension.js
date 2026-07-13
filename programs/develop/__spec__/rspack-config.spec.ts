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

    const ignored = config.watchOptions?.ignored as string[]
    expect(ignored).toContain('**/node_modules/**')
  })

  it('ignores by path segment, not substring — a project path containing "dist" stays watched', () => {
    // Regression: the ignore list was a substring regex (/dist|…/), so a
    // checkout named e.g. "dedistract" matched and the ENTIRE project was
    // unwatched — dev booted fine and then never recompiled any edit.
    resolveTranspilePackageDirsMock.mockReturnValue([])
    const projectStructure = createProjectStructure()
    const root = path.dirname(projectStructure.manifestPath)
    const config = webpackConfig(
      projectStructure as any,
      {
        browser: 'chrome',
        mode: 'development',
        output: {
          clean: false,
          path: path.join(root, 'dist', 'chrome')
        },
        noBrowser: true
      } as any
    )

    const ignored = config.watchOptions?.ignored as string[]
    expect(Array.isArray(ignored)).toBe(true)
    const posixRoot = root.split(path.sep).join('/')
    // The real output dir is ignored…
    expect(ignored).toContain(`${posixRoot}/dist/chrome/**`)
    expect(ignored).toContain(`${posixRoot}/dist/**`)
    // …but no bare-substring pattern survives that could swallow a source
    // path like /home/user/dedistract/shared.js.
    for (const pattern of ignored) {
      expect(pattern === 'dist' || pattern === '**dist**').toBe(false)
      if (typeof pattern === 'string' && pattern.includes('dist')) {
        expect(pattern.includes('/dist/') || pattern.endsWith('/dist/**')).toBe(
          true
        )
      }
    }
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

    const ignored = config.watchOptions?.ignored as string[]
    expect(ignored).not.toContain('**/node_modules/**')
    const root = path
      .dirname(projectStructure.manifestPath)
      .split(path.sep)
      .join('/')
    expect(ignored).toContain(`${root}/dist/chrome/**`)
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

  it('never emits assets for errored compiles, in dev and prod', () => {
    // Regression guard for §29: rspack defaults emitOnErrors to true
    // (webpack 5 flipped to false), so a failed watch compile overwrote the
    // last-good dist with error-stub modules and bricked unpacked consumers.
    resolveTranspilePackageDirsMock.mockReturnValue([])
    const projectStructure = createProjectStructure()
    for (const mode of ['development', 'production'] as const) {
      const config = webpackConfig(
        projectStructure as any,
        {
          browser: 'chrome',
          mode,
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
      expect(config.optimization?.emitOnErrors).toBe(false)
    }
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

  it('hashes content-script bundles per-entry by default in development', () => {
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

    const filename = config.output?.filename as any
    expect(typeof filename).toBe('function')
    expect(filename({chunk: {name: 'content_scripts/content-0'}})).toBe(
      'content_scripts/content-0.[contenthash:8].js'
    )
    expect(filename({chunk: {name: 'content_scripts/content-1'}})).toBe(
      'content_scripts/content-1.[contenthash:8].js'
    )
    expect(filename({chunk: {name: 'background/service_worker'}})).toBe(
      '[name].js'
    )
  })

  it('emits unhashed content-script filenames when hashContentScripts is false', () => {
    resolveTranspilePackageDirsMock.mockReturnValue([])
    const projectStructure = createProjectStructure()
    const config = webpackConfig(
      projectStructure as any,
      {
        browser: 'chrome',
        mode: 'development',
        hashContentScripts: false,
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

    expect(config.output?.filename).toBe('[name].js')
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

  it('resolves TypeScript NodeNext ".js" import specifiers to their TS source', () => {
    // A TS file importing './env.js' where the source is env.ts is standard,
    // correct TypeScript (the specifier names the EMITTED file). Without
    // extensionAlias it dies with "Can't resolve './env.js'", which blocks
    // every strict-ESM TS extension.
    const projectStructure = createProjectStructure()
    const config = webpackConfig(
      projectStructure as any,
      {
        mode: 'development',
        browser: 'chrome',
        output: {
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
    expect(resolve?.extensionAlias?.['.js']).toContain('.ts')
    expect(resolve?.extensionAlias?.['.js']).toContain('.tsx')
    // a real .js sibling must still resolve when there is no TS source
    expect(resolve?.extensionAlias?.['.js']).toContain('.js')
    expect(resolve?.extensionAlias?.['.mjs']).toContain('.mts')
  })

  it('externalizes chrome-extension:/moz-extension: URLs as passthrough assets', () => {
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

    const externalFn = (config.externals as any[])[0] as (
      data: {request?: string},
      cb: (err?: null, result?: string, type?: string) => void
    ) => void
    expect(typeof externalFn).toBe('function')

    const run = (request: string): [string | undefined, string | undefined] => {
      let captured: [string | undefined, string | undefined] = [
        undefined,
        undefined
      ]
      externalFn({request}, (_e, result, type) => {
        captured = [result, type]
      })
      return captured
    }

    // chrome-extension:// and moz-extension:// pass through verbatim as `asset`
    // so the URL string (incl. the __MSG_@@extension_id__ placeholder) survives.
    expect(run('chrome-extension://__MSG_@@extension_id__/dino.png')).toEqual([
      'chrome-extension://__MSG_@@extension_id__/dino.png',
      'asset'
    ])
    expect(run('moz-extension://abc/icon.png')).toEqual([
      'moz-extension://abc/icon.png',
      'asset'
    ])
    // Safari's scheme must pass through too (G11) — cross-browser extensions
    // reference `safari-web-extension://__MSG_@@extension_id__/…` in CSS url().
    expect(
      run('safari-web-extension://__MSG_@@extension_id__/icons/x.svg')
    ).toEqual([
      'safari-web-extension://__MSG_@@extension_id__/icons/x.svg',
      'asset'
    ])
    // Ordinary requests are not externalized (callback invoked with no args).
    expect(run('./icon.png')).toEqual([undefined, undefined])
    expect(run('https://example.com/x.png')).toEqual([undefined, undefined])
  })

  it('passes a missing relative CSS url() asset through verbatim, but bundles an existing one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-css-asset-'))
    fs.writeFileSync(path.join(dir, 'present.png'), 'x')

    const projectStructure = createProjectStructure()
    const config = webpackConfig(
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

    const externalFn = (config.externals as any[])[0] as (
      data: {request?: string; dependencyType?: string; context?: string},
      cb: (err?: null, result?: string, type?: string) => void
    ) => void

    const run = (request: string, dependencyType?: string) => {
      let captured: [string | undefined, string | undefined] = [
        undefined,
        undefined
      ]
      externalFn(
        {request, dependencyType, context: dir},
        (_e, result, type) => {
          captured = [result, type]
        }
      )
      return captured
    }

    // Missing relative url() asset → left verbatim as `asset` (browser tolerates).
    expect(run('images/missing.png', 'url')).toEqual([
      'images/missing.png',
      'asset'
    ])
    // Query/hash suffixes (fonts) are ignored when checking existence.
    expect(run('fonts/missing.woff?v=2', 'url')).toEqual([
      'fonts/missing.woff?v=2',
      'asset'
    ])
    // An existing file resolves/bundles normally — NOT externalized.
    expect(run('present.png', 'url')).toEqual([undefined, undefined])
    // Non-url dependency types are never treated as CSS assets.
    expect(run('images/missing.png', 'esm')).toEqual([undefined, undefined])
  })
})
