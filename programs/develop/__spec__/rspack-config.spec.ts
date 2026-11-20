import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it, vi} from 'vitest'
import {CompilationPlugin} from '../plugin-compilation'
import {ReadyContractPlugin} from '../plugin-ready-contract'
import {WarnManifestV2OnChromium} from '../plugin-web-extension/feature-manifest/steps/warn-mv2-on-chromium'
import webpackConfig from '../rspack-config'
import {writeProjectFiles} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

const makeTempFolder = trackTempFolders()

// A dependency the project names with the workspace protocol and that sits
// in its node_modules, which is what makes the build transpile and watch it.
function linkWorkspacePackage(
  projectStructure: {packageJsonPath: string},
  name: string
) {
  const root = path.dirname(projectStructure.packageJsonPath)

  writeProjectFiles(root, {
    'package.json': {name: 'demo', dependencies: {[name]: 'workspace:*'}},
    [`node_modules/${name}/package.json`]: {name, version: '0.0.0'},
    [`node_modules/${name}/index.js`]: 'export const ui = true\n'
  })
}

function createProjectStructure() {
  const root = makeTempFolder('extjs-webpack-config-')
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

  it('keeps .git ignored, with and without transpiled packages', () => {
    for (const linked of [false, true]) {
      const projectStructure = createProjectStructure()

      if (linked) linkWorkspacePackage(projectStructure, '@workspace/ui')

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

      expect(config.watchOptions?.ignored).toContain('**/.git/**')
      expect(
        (config.watchOptions?.ignored as string[]).includes(
          '**/node_modules/**'
        )
      ).toBe(!linked)
    }
  })

  it('ignores by path segment, not substring, a project path containing "dist" stays watched', () => {
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
    expect(ignored).toContain(`${posixRoot}/dist`)

    for (const pattern of ignored) {
      expect(pattern === 'dist' || pattern === '**dist**').toBe(false)

      if (typeof pattern === 'string' && pattern.includes('dist')) {
        expect(
          pattern.includes('/dist/') ||
            pattern.endsWith('/dist/**') ||
            pattern === `${posixRoot}/dist`
        ).toBe(true)
      }
    }
  })

  it('does not blanket-ignore node_modules when transpiled packages are auto-detected', () => {
    const projectStructure = createProjectStructure()

    linkWorkspacePackage(projectStructure, '@workspace/ui')

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

  it('warns once about a named companion that is not an extension', async () => {
    const {takeCodedWarnings} = await import('../lib/coded-warnings')
    const projectStructure = createProjectStructure()
    const root = path.dirname(projectStructure.manifestPath)
    const missing = path.join(root, 'extensions', 'gone')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const session = () =>
      webpackConfig(
        projectStructure as any,
        {
          browser: 'chrome',
          mode: 'development',
          metadataCommand: 'dev',
          extensions: {paths: [missing]},
          output: {clean: false, path: path.join(root, 'dist', 'chrome')},
          noBrowser: true
        } as any
      )

    takeCodedWarnings()

    try {
      session()

      const coded = takeCodedWarnings()

      expect(coded).toHaveLength(1)
      expect(coded[0]).toMatch(/^W_COMPANION_EXTENSION_PATH: /)
      expect(coded[0]).toContain(path.join(missing, 'manifest.json'))
      expect(warn).toHaveBeenCalledTimes(1)

      // A restart builds the config again and has nothing new to say.
      session()

      expect(takeCodedWarnings()).toEqual([])
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  // The built-in companions resolve from the compiled package only, and
  // companion-extensions-to-load.spec.ts covers them there.
  it('hands the browser a companion the project names, then the user output', () => {
    const projectStructure = createProjectStructure()
    const root = path.dirname(projectStructure.manifestPath)
    const output = path.join(root, 'dist', 'chrome')
    const companion = path.join(root, 'extensions', 'helper')
    const browsersPlugin = {apply() {}, extensionsToLoad: [] as string[]}

    writeProjectFiles(companion, {
      'manifest.json': {manifest_version: 3, name: 'helper', version: '1.0.0'}
    })

    webpackConfig(
      projectStructure as any,
      {
        browser: 'chrome',
        mode: 'development',
        extensions: {paths: [companion]},
        output: {clean: false, path: output},
        browsersPlugin
      } as any
    )

    expect(browsersPlugin.extensionsToLoad).toEqual([companion, output])
  })

  it('hashes content-script bundles per-entry by default in development', () => {
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
    expect(resolve?.extensionAlias?.['.cjs']).toContain('.cts')
    expect(resolve?.extensions).toContain('.cts')
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
    const dir = makeTempFolder('extjs-css-asset-')
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

  it('leaves an unresolvable bare require() verbatim as a commonjs external, fatal under EXTENSION_STRICT_REFS', () => {
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
        else if (request === 'ignored-pkg') cb(null, false)
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
    // An alias to false is rspack's empty module, so it stays with the bundler.
    expect(run('ignored-pkg')).toEqual([undefined, undefined])
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

describe('a scanned companion entry that leads outside the project', () => {
  function configFor(options: Record<string, unknown>) {
    const projectStructure = createProjectStructure()
    const root = path.dirname(projectStructure.manifestPath)
    const outside = makeTempFolder('extjs-webpack-config-outside-')
    const said: string[] = []

    fs.writeFileSync(
      path.join(outside, 'manifest.json'),
      JSON.stringify({manifest_version: 3, name: 'out', version: '1.0.0'})
    )

    fs.mkdirSync(path.join(root, 'extensions'))
    fs.symlinkSync(outside, path.join(root, 'extensions', 'linked-out'))

    const spy = vi
      .spyOn(console, 'warn')
      .mockImplementation((...parts: unknown[]) => {
        said.push(parts.map(String).join(' '))
      })

    try {
      webpackConfig(
        projectStructure as any,
        {
          browser: 'chrome',
          mode: 'development',
          extensions: {dir: './extensions'},
          output: {clean: false, path: path.join(root, 'dist', 'chrome')},
          ...options
        } as any
      )
    } finally {
      spy.mockRestore()
    }

    return said.filter((text) => text.includes('leads outside the project'))
  }

  it.skipIf(process.platform === 'win32')(
    'is said by a session that opens a browser',
    () => {
      const browsersPlugin = {apply() {}, extensionsToLoad: []}

      expect(configFor({browsersPlugin})).toHaveLength(1)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'is not said by a session that opens none',
    () => {
      expect(configFor({noBrowser: true})).toEqual([])
    }
  )
})

describe('webpack-config MV2 on chromium warning', () => {
  const buildConfig = (manifest: Record<string, unknown>) => {
    const root = makeTempFolder('extjs-webpack-config-')
    const packageJsonPath = path.join(root, 'package.json')
    const manifestPath = path.join(root, 'manifest.json')
    fs.writeFileSync(packageJsonPath, JSON.stringify({name: 'demo'}), 'utf-8')
    fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf-8')

    return webpackConfig(
      {manifestPath, packageJsonPath} as any,
      {
        browser: 'chrome',
        mode: 'production',
        output: {clean: false, path: path.join(root, 'dist', 'chrome')},
        noBrowser: true
      } as any
    )
  }

  const captureMv2Tap = (config: any) => {
    let tapped: ((compilation: any) => void) | undefined
    const hook = {
      tap: (nameOrOptions: any, fn: any) => {
        const name =
          typeof nameOrOptions === 'string'
            ? nameOrOptions
            : nameOrOptions?.name
        if (name === 'warn-mv2-on-chromium') tapped = fn
      },
      tapAsync: () => undefined,
      tapPromise: () => undefined
    }
    const compiler: any = {
      hooks: new Proxy({}, {get: () => hook}),
      rspack: {WebpackError: Error},
      options: {}
    }

    for (const plugin of config.plugins ?? []) {
      if (plugin instanceof WarnManifestV2OnChromium) plugin.apply(compiler)
    }

    return tapped
  }

  it('warns that an MV2 extension manifest will not install on chromium', () => {
    const config = buildConfig({
      manifest_version: 2,
      name: 'x',
      version: '1.0.0'
    })
    const tap = captureMv2Tap(config)
    expect(tap).toBeDefined()

    const compilation: any = {warnings: []}
    tap?.(compilation)
    expect(compilation.warnings).toHaveLength(1)
    expect(String(compilation.warnings[0])).toMatch(/will not install/)
  })

  it('stays quiet for an MV2 theme manifest, which Chrome still installs', () => {
    const config = buildConfig({
      manifest_version: 2,
      name: 'x',
      version: '1.0.0',
      theme: {colors: {frame: [0, 0, 0]}}
    })
    expect(captureMv2Tap(config)).toBeUndefined()
  })

  it('stays quiet for MV3 manifests', () => {
    const config = buildConfig({
      manifest_version: 3,
      name: 'x',
      version: '1.0.0'
    })
    expect(captureMv2Tap(config)).toBeUndefined()
  })
})

describe('ready contract carries the control-bridge bind reason', () => {
  const bindReason = 'listen EADDRNOTAVAIL 10.0.0.9:0'

  function findReadyContractPlugin(config: any) {
    const plugin = (config.plugins ?? []).find(
      (candidate: any) => candidate instanceof ReadyContractPlugin
    ) as any

    expect(plugin).toBeDefined()

    return plugin
  }

  function buildReadyContractPlugin() {
    const projectStructure = createProjectStructure()
    const root = path.dirname(projectStructure.manifestPath)
    const config = webpackConfig(
      projectStructure as any,
      {
        browser: 'chrome',
        mode: 'development',
        metadataCommand: 'dev',
        controlPort: null,
        controlPath: '/__extension_control',
        controlPortUnavailableReason: bindReason,
        output: {clean: false, path: path.join(root, 'dist', 'chrome')},
        noBrowser: true
      } as any
    )

    const plugin = findReadyContractPlugin(config)

    return {plugin, root}
  }

  function applyWithFakeCompiler(plugin: any) {
    const taps: Record<string, (arg?: unknown) => void> = {}
    const hook = (name: string) => ({
      tap: (_pluginName: string, fn: (arg?: unknown) => void) => {
        taps[name] = fn
      }
    })

    plugin.apply({
      hooks: {
        compile: hook('compile'),
        done: hook('done'),
        failed: hook('failed'),
        watchClose: hook('watchClose')
      }
    })

    return taps
  }

  function readReady(root: string) {
    return JSON.parse(
      fs.readFileSync(
        path.join(root, 'dist', 'extension-js', 'chrome', 'ready.json'),
        'utf-8'
      )
    )
  }

  it('keeps the reason through writeStarting and the first compile', () => {
    const {plugin, root} = buildReadyContractPlugin()
    const taps = applyWithFakeCompiler(plugin)

    const starting = readReady(root)
    expect(starting.status).toBe('starting')
    expect(starting.controlPort).toBeNull()
    expect(starting.controlPortUnavailableReason).toBe(bindReason)

    taps.done({
      compilation: {startTime: 0, endTime: 10},
      hasErrors: () => false,
      toJson: () => ({errors: []})
    })

    const ready = readReady(root)
    expect(ready.status).toBe('ready')
    expect(ready.controlPortUnavailableReason).toBe(bindReason)
  })

  it('omits the field when the control bridge bound', () => {
    const projectStructure = createProjectStructure()
    const root = path.dirname(projectStructure.manifestPath)
    const config = webpackConfig(
      projectStructure as any,
      {
        browser: 'chrome',
        mode: 'development',
        metadataCommand: 'dev',
        controlPort: 50111,
        output: {clean: false, path: path.join(root, 'dist', 'chrome')},
        noBrowser: true
      } as any
    )
    applyWithFakeCompiler(findReadyContractPlugin(config))

    const ready = readReady(root)
    expect(ready.controlPort).toBe(50111)
    expect('controlPortUnavailableReason' in ready).toBe(false)
  })

  it('taps only hooks the fake compiler provides', () => {
    const {plugin} = buildReadyContractPlugin()
    const taps = applyWithFakeCompiler(plugin)

    expect(Object.keys(taps).sort()).toEqual([
      'compile',
      'done',
      'failed',
      'watchClose'
    ])
  })
})

describe('the compile line is told whether a browser launches', () => {
  const launchSetting = (noBrowser: boolean | undefined) => {
    const projectStructure = createProjectStructure()
    const root = path.dirname(projectStructure.manifestPath)
    const config = webpackConfig(
      projectStructure as any,
      {
        browser: 'chrome',
        mode: 'development',
        metadataCommand: 'dev',
        output: {clean: false, path: path.join(root, 'dist', 'chrome')},
        noBrowser
      } as any
    )
    const plugin = (config.plugins || []).find(
      (entry) => entry instanceof CompilationPlugin
    ) as CompilationPlugin

    return plugin.browserLaunchEnabled
  }

  it('says no for a session started without a browser', () => {
    expect(launchSetting(true)).toBe(false)
  })

  it('says yes otherwise, whatever another session left in the environment', () => {
    vi.stubEnv('EXTENSION_BROWSER_LAUNCH_ENABLED', '0')

    try {
      expect(launchSetting(false)).toBe(true)
      expect(launchSetting(undefined)).toBe(true)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
