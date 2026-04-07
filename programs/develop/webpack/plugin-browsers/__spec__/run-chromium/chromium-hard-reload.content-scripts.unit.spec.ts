import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {describe, expect, it, vi} from 'vitest'
import {ChromiumHardReloadPlugin} from '../../run-chromium/chromium-hard-reload'

describe('ChromiumHardReloadPlugin content-script reload flow', () => {
  it('reloads matching tabs instead of hard reloading the extension', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler: ((stats: any) => Promise<void>) | undefined

    const compiler: any = {
      options: {context: '/project'},
      getInfrastructureLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      }),
      hooks: {
        watchRun: {
          tapAsync: (_name: string, handler: any) => {
            watchRunHandler = handler
          }
        },
        done: {
          tapPromise: (_name: string, handler: any) => {
            doneHandler = handler
          }
        }
      }
    }

    const hardReload = vi.fn(async () => true)
    const reloadMatchingTabsForContentScripts = vi.fn(async () => 1)

    const ctx: any = {
      getController: () => ({
        hardReload,
        reloadMatchingTabsForContentScripts,
        getDeveloperModeStatus: () => 'enabled'
      }),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: () => {},
      getPendingReloadReason: () => undefined,
      clearPendingReloadReason: () => {}
    }

    const plugin = new ChromiumHardReloadPlugin({}, ctx)
    plugin.apply(compiler)

    ;(plugin as any).hasCompletedSuccessfulBuild = true
    ;(plugin as any).contentReloadQuietPeriodMs = 0
    ;(plugin as any).contentReloadFollowupMs = 0
    ;(plugin as any).firstSuccessfulBuildAtMs = 0
    ;(plugin as any).contentScriptSourceDependencyPathsByEntry = new Map([
      ['content_scripts/content-0', new Set(['/project/src/content.ts'])]
    ])

    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>(['/project/src/content.ts'])
      },
      () => {}
    )

    const manifestSource = JSON.stringify({
      content_scripts: [{matches: ['https://docs.example.com/*']}]
    })
    const stats = {
      hasErrors: () => false,
      compilation: {
        assets: {
          'manifest.json': {
            source: () => manifestSource
          }
        },
        getAsset: (name: string) =>
          name === 'manifest.json'
            ? ({
                source: {
                  source: () => manifestSource
                }
              } as any)
            : undefined,
        entrypoints: new Map(),
        chunkGraph: {}
      }
    }

    await (doneHandler as any)(stats)

    expect(reloadMatchingTabsForContentScripts).toHaveBeenCalledTimes(1)
    expect(hardReload).toHaveBeenCalledTimes(1)
  })

  it('ignores unrelated source edits that are not tracked as content script dependencies', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler: ((stats: any) => Promise<void>) | undefined

    const compiler: any = {
      options: {context: '/project'},
      getInfrastructureLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      }),
      hooks: {
        watchRun: {
          tapAsync: (_name: string, handler: any) => {
            watchRunHandler = handler
          }
        },
        done: {
          tapPromise: (_name: string, handler: any) => {
            doneHandler = handler
          }
        }
      }
    }

    const hardReload = vi.fn(async () => true)
    const reloadMatchingTabsForContentScripts = vi.fn(async () => 1)

    const ctx: any = {
      getController: () => ({
        hardReload,
        reloadMatchingTabsForContentScripts,
        getDeveloperModeStatus: () => 'enabled'
      }),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: () => {},
      getPendingReloadReason: () => undefined,
      clearPendingReloadReason: () => {}
    }

    const plugin = new ChromiumHardReloadPlugin({}, ctx)
    plugin.apply(compiler)

    ;(plugin as any).hasCompletedSuccessfulBuild = true
    ;(plugin as any).contentReloadQuietPeriodMs = 0
    ;(plugin as any).contentReloadFollowupMs = 0
    ;(plugin as any).firstSuccessfulBuildAtMs = 0
    ;(plugin as any).contentScriptSourceDependencyPathsByEntry = new Map([
      ['content_scripts/content-0', new Set(['/project/src/content.ts'])]
    ])

    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>(['/project/src/not-a-content-script.ts'])
      },
      () => {}
    )

    const manifestSource = JSON.stringify({
      content_scripts: [{matches: ['https://docs.example.com/*']}]
    })
    const stats = {
      hasErrors: () => false,
      compilation: {
        assets: {
          'manifest.json': {
            source: () => manifestSource
          }
        },
        getAsset: (name: string) =>
          name === 'manifest.json'
            ? ({
                source: {
                  source: () => manifestSource
                }
              } as any)
            : undefined,
        entrypoints: new Map(),
        chunkGraph: {}
      }
    }

    await (doneHandler as any)(stats)

    expect(reloadMatchingTabsForContentScripts).not.toHaveBeenCalled()
    expect(hardReload).not.toHaveBeenCalled()
  })

  it('falls back to emitted content assets when watchRun misses the source dependency', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler: ((stats: any) => Promise<void>) | undefined

    const compiler: any = {
      options: {context: '/project'},
      getInfrastructureLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      }),
      hooks: {
        watchRun: {
          tapAsync: (_name: string, handler: any) => {
            watchRunHandler = handler
          }
        },
        done: {
          tapPromise: (_name: string, handler: any) => {
            doneHandler = handler
          }
        }
      }
    }

    const hardReload = vi.fn(async () => true)
    const reloadMatchingTabsForContentScripts = vi.fn(async () => 1)

    const ctx: any = {
      getController: () => ({
        hardReload,
        reloadMatchingTabsForContentScripts,
        getDeveloperModeStatus: () => 'enabled'
      }),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: () => {},
      getPendingReloadReason: () => undefined,
      clearPendingReloadReason: () => {}
    }

    const plugin = new ChromiumHardReloadPlugin({}, ctx)
    plugin.apply(compiler)

    ;(plugin as any).hasCompletedSuccessfulBuild = true
    ;(plugin as any).contentReloadQuietPeriodMs = 0
    ;(plugin as any).contentReloadFollowupMs = 0
    ;(plugin as any).firstSuccessfulBuildAtMs = 0
    ;(plugin as any).contentScriptSourceDependencyPathsByEntry = new Map([
      ['content_scripts/content-0', new Set(['/project/src/content.ts'])]
    ])

    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>(['/project'])
      },
      () => {}
    )

    const manifestSource = JSON.stringify({
      content_scripts: [{matches: ['https://docs.example.com/*']}]
    })
    const stats = {
      hasErrors: () => false,
      compilation: {
        assets: {
          'manifest.json': {
            source: () => manifestSource
          }
        },
        getAsset: (name: string) =>
          name === 'manifest.json'
            ? ({
                source: {
                  source: () => manifestSource
                }
              } as any)
            : undefined,
        getAssets: () => [
          {name: 'content_scripts/content-0.js', emitted: true}
        ],
        entrypoints: new Map(),
        chunkGraph: {}
      }
    }

    await (doneHandler as any)(stats)

    expect(reloadMatchingTabsForContentScripts).toHaveBeenCalledTimes(1)
    expect(hardReload).toHaveBeenCalledTimes(1)
  })

  it('falls back to hot update assets for content scripts when main bundles are not marked emitted', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler: ((stats: any) => Promise<void>) | undefined

    const compiler: any = {
      options: {context: '/project'},
      getInfrastructureLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      }),
      hooks: {
        watchRun: {
          tapAsync: (_name: string, handler: any) => {
            watchRunHandler = handler
          }
        },
        done: {
          tapPromise: (_name: string, handler: any) => {
            doneHandler = handler
          }
        }
      }
    }

    const hardReload = vi.fn(async () => true)
    const reloadMatchingTabsForContentScripts = vi.fn(async () => 1)

    const ctx: any = {
      getController: () => ({
        hardReload,
        reloadMatchingTabsForContentScripts,
        getDeveloperModeStatus: () => 'enabled'
      }),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: () => {},
      getPendingReloadReason: () => undefined,
      clearPendingReloadReason: () => {}
    }

    const plugin = new ChromiumHardReloadPlugin({}, ctx)
    plugin.apply(compiler)

    ;(plugin as any).hasCompletedSuccessfulBuild = true
    ;(plugin as any).contentReloadQuietPeriodMs = 0
    ;(plugin as any).contentReloadFollowupMs = 0
    ;(plugin as any).firstSuccessfulBuildAtMs = 0
    ;(plugin as any).contentScriptSourceDependencyPathsByEntry = new Map([
      ['content_scripts/content-0', new Set(['/project/src/content.ts'])]
    ])

    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>(['/project'])
      },
      () => {}
    )

    const manifestSource = JSON.stringify({
      content_scripts: [{matches: ['https://docs.example.com/*']}]
    })
    const stats = {
      hasErrors: () => false,
      compilation: {
        assets: {
          'manifest.json': {
            source: () => manifestSource
          }
        },
        getAsset: (name: string) =>
          name === 'manifest.json'
            ? ({
                source: {
                  source: () => manifestSource
                }
              } as any)
            : undefined,
        getAssets: () => [
          {name: 'hot/content_scripts/content-0.abcd1234.json', emitted: true}
        ],
        entrypoints: new Map(),
        chunkGraph: {}
      }
    }

    await (doneHandler as any)(stats)

    expect(reloadMatchingTabsForContentScripts).toHaveBeenCalledTimes(1)
    expect(hardReload).toHaveBeenCalledTimes(1)
  })

  it('falls back to tracked source signatures when watchRun only reports the project root', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler: ((stats: any) => Promise<void>) | undefined

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-chromium-'))
    const contentFilePath = path.join(tempRoot, 'src', 'content.ts')
    fs.mkdirSync(path.dirname(contentFilePath), {recursive: true})
    fs.writeFileSync(contentFilePath, 'export const value = "before"\n', 'utf8')

    try {
      const compiler: any = {
        options: {context: tempRoot},
        getInfrastructureLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn()
        }),
        hooks: {
          watchRun: {
            tapAsync: (_name: string, handler: any) => {
              watchRunHandler = handler
            }
          },
          done: {
            tapPromise: (_name: string, handler: any) => {
              doneHandler = handler
            }
          }
        }
      }

      const hardReload = vi.fn(async () => true)
      const reloadMatchingTabsForContentScripts = vi.fn(async () => 1)

      const ctx: any = {
        getController: () => ({
          hardReload,
          reloadMatchingTabsForContentScripts,
          getDeveloperModeStatus: () => 'enabled'
        }),
        onControllerReady: () => {},
        setController: () => {},
        getPorts: () => ({}),
        getExtensionRoot: () => path.join(tempRoot, 'dist', 'chromium'),
        setExtensionRoot: () => {},
        setServiceWorkerPaths: () => {},
        getServiceWorkerPaths: () => ({}),
        setPendingReloadReason: () => {},
        getPendingReloadReason: () => undefined,
        clearPendingReloadReason: () => {}
      }

      const plugin = new ChromiumHardReloadPlugin({}, ctx)
      plugin.apply(compiler)

      ;(plugin as any).hasCompletedSuccessfulBuild = true
      ;(plugin as any).contentReloadQuietPeriodMs = 0
      ;(plugin as any).contentReloadFollowupMs = 0
      ;(plugin as any).firstSuccessfulBuildAtMs = 0
      ;(plugin as any).contentScriptSourceDependencyPathsByEntry = new Map([
        ['content_scripts/content-0', new Set([contentFilePath])]
      ])
      ;(plugin as any).contentScriptSourceSignaturesByEntry = new Map([
        [
          'content_scripts/content-0',
          new Map([
            [
              contentFilePath,
              `${fs.statSync(contentFilePath).size}:${fs.statSync(contentFilePath).mtimeMs}`
            ]
          ])
        ]
      ])

      fs.writeFileSync(
        contentFilePath,
        'export const value = "after"\n',
        'utf8'
      )

      ;(watchRunHandler as any)(
        {
          modifiedFiles: new Set<string>([tempRoot])
        },
        () => {}
      )

      const manifestSource = JSON.stringify({
        content_scripts: [{matches: ['https://docs.example.com/*']}]
      })
      const stats = {
        hasErrors: () => false,
        compilation: {
          assets: {
            'manifest.json': {
              source: () => manifestSource
            }
          },
          getAsset: (name: string) =>
            name === 'manifest.json'
              ? ({
                  source: {
                    source: () => manifestSource
                  }
                } as any)
              : undefined,
          getAssets: () => [],
          entrypoints: new Map(),
          chunkGraph: {}
        }
      }

      await (doneHandler as any)(stats)

      expect(reloadMatchingTabsForContentScripts).toHaveBeenCalledTimes(1)
      expect(hardReload).toHaveBeenCalledTimes(1)
    } finally {
      fs.rmSync(tempRoot, {recursive: true, force: true})
    }
  })

  it('derives canonical content entry files when entrypoint metadata is unavailable', () => {
    const extensionRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ext-content-entry-files-')
    )
    fs.mkdirSync(path.join(extensionRoot, 'content_scripts'), {recursive: true})
    fs.writeFileSync(
      path.join(extensionRoot, 'content_scripts', 'content-0.js'),
      '// js',
      'utf8'
    )
    fs.writeFileSync(
      path.join(extensionRoot, 'content_scripts', 'content-0.css'),
      'body{}',
      'utf8'
    )

    const plugin = new ChromiumHardReloadPlugin({}, {} as any) as any

    try {
      expect(
        plugin.collectEntrypointFiles(
          {entrypoints: undefined},
          ['content_scripts/content-0'],
          extensionRoot
        )
      ).toEqual([
        'content_scripts/content-0.js',
        'content_scripts/content-0.css'
      ])
    } finally {
      fs.rmSync(extensionRoot, {recursive: true, force: true})
    }
  })
})
