import * as fs from 'node:fs'
import os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it, vi} from 'vitest'
import webpackConfig from '../rspack-config'

const resolveTranspilePackageDirsMock = vi.hoisted(() =>
  vi.fn<(..._args: any[]) => string[]>(() => [])
)
const computeExtensionsToLoadMock = vi.hoisted(() =>
  vi.fn<(..._args: any[]) => string[]>(() => [])
)

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

  it('ignores by path segment, not substring, a project path containing "dist" stays watched', () => {
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
    expect(ignored).toContain(`${posixRoot}/dist/chrome/**`)
    expect(ignored).toContain(`${posixRoot}/dist/**`)
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

    expect(run('chrome-extension://__MSG_@@extension_id__/dino.png')).toEqual([
      'chrome-extension://__MSG_@@extension_id__/dino.png',
      'asset'
    ])
    expect(run('moz-extension://abc/icon.png')).toEqual([
      'moz-extension://abc/icon.png',
      'asset'
    ])
    expect(
      run('safari-web-extension://__MSG_@@extension_id__/icons/x.svg')
    ).toEqual([
      'safari-web-extension://__MSG_@@extension_id__/icons/x.svg',
      'asset'
    ])
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

    expect(run('images/missing.png', 'url')).toEqual([
      'images/missing.png',
      'asset'
    ])
    expect(run('fonts/missing.woff?v=2', 'url')).toEqual([
      'fonts/missing.woff?v=2',
      'asset'
    ])
    expect(run('present.png', 'url')).toEqual([undefined, undefined])
    expect(run('images/missing.png', 'esm')).toEqual([undefined, undefined])
  })

  it('leaves an unresolvable bare require() verbatim as a commonjs external (§36), fatal under EXTENSION_STRICT_REFS', () => {
    const projectStructure = createProjectStructure()
    const makeExternalFn = () => {
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
      return (config.externals as any[])[0] as (
        data: {
          request?: string
          dependencyType?: string
          context?: string
          contextInfo?: {issuer: string}
          getResolve?: () => (
            context: string,
            request: string,
            cb: (err?: Error | null, result?: string | false) => void
          ) => void
        },
        cb: (err?: null, result?: string, type?: string) => void
      ) => void
    }
    const externalFn = makeExternalFn()

    const getResolve =
      () =>
      (
        _context: string,
        request: string,
        cb: (err?: Error | null, result?: string | false) => void
      ) => {
        if (request === 'resolvable-pkg') cb(null, '/fake/node_modules/x.js')
        else cb(new Error(`Can't resolve '${request}'`))
      }

    const run = (request: string, dependencyType = 'commonjs') => {
      let captured: [string | undefined, string | undefined] = [
        undefined,
        undefined
      ]
      externalFn(
        {
          request,
          dependencyType,
          context: '/some/project',
          contextInfo: {issuer: '/some/project/vendored.js'},
          getResolve
        },
        (_e, result, type) => {
          captured = [result, type]
        }
      )
      return captured
    }

    expect(run('file')).toEqual(['file', 'commonjs'])
    expect(run('system')).toEqual(['system', 'commonjs'])
    expect(run('resolvable-pkg')).toEqual([undefined, undefined])
    expect(run('./missing-local')).toEqual([undefined, undefined])
    expect(run('/abs/missing')).toEqual([undefined, undefined])
    expect(run('fs')).toEqual([undefined, undefined])
    expect(run('path')).toEqual([undefined, undefined])
    expect(run('file', 'esm')).toEqual([undefined, undefined])

    process.env.EXTENSION_STRICT_REFS = 'true'
    try {
      expect(run('file')).toEqual([undefined, undefined])
    } finally {
      delete process.env.EXTENSION_STRICT_REFS
    }
  })
})
