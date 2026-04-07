import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {ChromiumHardReloadPlugin} from '../../run-chromium/chromium-hard-reload'

vi.mock('../../run-chromium/manifest-readiness', () => ({
  waitForStableManifest: vi.fn(async () => true)
}))

describe('ChromiumHardReloadPlugin - manifest hard reload flow', () => {
  const previousAuthorMode = process.env.EXTENSION_AUTHOR_MODE

  afterEach(() => {
    if (typeof previousAuthorMode === 'undefined') {
      delete process.env.EXTENSION_AUTHOR_MODE
      return
    }
    process.env.EXTENSION_AUTHOR_MODE = previousAuthorMode
  })

  it('does not emit extension_reload action event when source flags are disabled', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler: ((stats: any) => Promise<void>) | undefined

    const compiler: any = {
      options: {context: '/project/templates/react'},
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
    let pendingReason: 'manifest' | 'locales' | 'sw' | undefined

    const ctx: any = {
      getController: () => ({
        hardReload,
        reloadMatchingTabsForContentScripts
      }),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/templates/react/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: (reason?: 'manifest' | 'locales' | 'sw') => {
        pendingReason = reason
      },
      getPendingReloadReason: () => pendingReason,
      clearPendingReloadReason: () => {
        pendingReason = undefined
      }
    }

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(7000)
    const plugin = new ChromiumHardReloadPlugin({}, ctx)
    plugin.apply(compiler)
    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>([
          '/project/templates/react/src/manifest.json'
        ])
      },
      () => {}
    )

    const stats = {
      hasErrors: () => false,
      compilation: {
        getAsset: (name: string) =>
          name === 'manifest.json'
            ? {
                source: {
                  source: () =>
                    JSON.stringify({
                      content_scripts: [
                        {
                          matches: ['https://example.com/*']
                        }
                      ]
                    })
                }
              }
            : undefined,
        assets: {
          'manifest.json': {
            source: () =>
              JSON.stringify({
                content_scripts: [
                  {
                    matches: ['https://example.com/*']
                  }
                ]
              })
          }
        },
        entrypoints: new Map(),
        chunkGraph: {}
      },
      toJson: () => ({assets: []})
    }
    await (doneHandler as any)(stats)
    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>([
          '/project/templates/react/src/manifest.json'
        ])
      },
      () => {}
    )
    await (doneHandler as any)(stats)

    expect(hardReload).toHaveBeenCalledTimes(1)
    expect(consoleLogSpy).not.toHaveBeenCalled()
    consoleLogSpy.mockRestore()
  })

  it('triggers controller hardReload when manifest changes in current context', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler: ((stats: any) => Promise<void>) | undefined

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }

    const compiler: any = {
      options: {context: '/project/templates/react'},
      getInfrastructureLogger: () => logger,
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
    let pendingReason: 'manifest' | 'locales' | 'sw' | undefined

    const ctx: any = {
      getController: () => ({
        hardReload,
        reloadMatchingTabsForContentScripts
      }),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/templates/react/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: (reason?: 'manifest' | 'locales' | 'sw') => {
        pendingReason = reason
      },
      getPendingReloadReason: () => pendingReason,
      clearPendingReloadReason: () => {
        pendingReason = undefined
      }
    }

    const plugin = new ChromiumHardReloadPlugin({}, ctx)
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(7000)
    plugin.apply(compiler)

    expect(watchRunHandler).toBeTypeOf('function')
    expect(doneHandler).toBeTypeOf('function')
    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>([
          '/project/templates/react/src/manifest.json'
        ])
      },
      () => {}
    )

    const stats = {
      hasErrors: () => false,
      compilation: {
        getAsset: (name: string) =>
          name === 'manifest.json'
            ? {
                source: {
                  source: () =>
                    JSON.stringify({
                      content_scripts: [
                        {
                          matches: ['https://example.com/*']
                        }
                      ]
                    })
                }
              }
            : undefined,
        assets: {
          'manifest.json': {
            source: () =>
              JSON.stringify({
                content_scripts: [
                  {
                    matches: ['https://example.com/*']
                  }
                ]
              })
          }
        },
        entrypoints: new Map(),
        chunkGraph: {}
      },
      toJson: () => ({assets: []})
    }
    await (doneHandler as any)(stats)
    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>([
          '/project/templates/react/src/manifest.json'
        ])
      },
      () => {}
    )
    await (doneHandler as any)(stats)

    expect(hardReload).toHaveBeenCalledTimes(1)
    expect(reloadMatchingTabsForContentScripts).toHaveBeenCalledTimes(2)
    expect(reloadMatchingTabsForContentScripts).toHaveBeenNthCalledWith(
      1,
      expect.any(Array),
      {allowCoarseCleanup: false}
    )
    expect(reloadMatchingTabsForContentScripts).toHaveBeenNthCalledWith(
      2,
      expect.any(Array),
      {preferPageReload: true}
    )
    expect(logger.info).toHaveBeenCalledWith(
      '[reload] reloading extension (reason:manifest)'
    )
  })

  it('triggers controller hardReload when root manifest changes in current context', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler: ((stats: any) => Promise<void>) | undefined

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }

    const compiler: any = {
      options: {context: '/project/templates/react'},
      getInfrastructureLogger: () => logger,
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
    let pendingReason: 'manifest' | 'locales' | 'sw' | undefined

    const ctx: any = {
      getController: () => ({hardReload}),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/templates/react/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: (reason?: 'manifest' | 'locales' | 'sw') => {
        pendingReason = reason
      },
      getPendingReloadReason: () => pendingReason,
      clearPendingReloadReason: () => {
        pendingReason = undefined
      }
    }

    const plugin = new ChromiumHardReloadPlugin({}, ctx)
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(7000)
    plugin.apply(compiler)

    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>([
          '/project/templates/react/manifest.json'
        ])
      },
      () => {}
    )

    const stats = {
      hasErrors: () => false,
      compilation: {
        assets: {
          'manifest.json': {
            source: () => JSON.stringify({})
          }
        },
        entrypoints: new Map(),
        chunkGraph: {}
      },
      toJson: () => ({assets: []})
    }
    await (doneHandler as any)(stats)
    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>([
          '/project/templates/react/manifest.json'
        ])
      },
      () => {}
    )
    await (doneHandler as any)(stats)

    expect(hardReload).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith(
      '[reload] reloading extension (reason:manifest)'
    )
  })

  it('ignores emitted dist manifest file changes for reload reasons', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler: ((stats: any) => Promise<void>) | undefined

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }

    const compiler: any = {
      options: {
        context: '/project/templates/react',
        output: {path: '/project/templates/react/dist/chromium'}
      },
      getInfrastructureLogger: () => logger,
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
    let pendingReason: 'manifest' | 'locales' | 'sw' | undefined

    const ctx: any = {
      getController: () => ({hardReload}),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/templates/react/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: (reason?: 'manifest' | 'locales' | 'sw') => {
        pendingReason = reason
      },
      getPendingReloadReason: () => pendingReason,
      clearPendingReloadReason: () => {
        pendingReason = undefined
      }
    }

    const plugin = new ChromiumHardReloadPlugin({}, ctx)
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(7000)
    plugin.apply(compiler)

    const stats = {
      hasErrors: () => false,
      compilation: {
        assets: {
          'manifest.json': {
            source: () => JSON.stringify({})
          }
        },
        entrypoints: new Map(),
        chunkGraph: {}
      },
      toJson: () => ({assets: []})
    }

    // Warmup successful build
    await (doneHandler as any)(stats)

    // Simulate watch invalidation due to emitted dist manifest write
    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>([
          '/project/templates/react/dist/chromium/manifest.json'
        ])
      },
      () => {}
    )
    await (doneHandler as any)(stats)

    expect(hardReload).not.toHaveBeenCalled()
  })

  it('emits extension_reload action event when source flags are enabled', async () => {
    process.env.EXTENSION_AUTHOR_MODE = 'true'
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler: ((stats: any) => Promise<void>) | undefined

    const compiler: any = {
      options: {context: '/project/templates/react'},
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
    let pendingReason: 'manifest' | 'locales' | 'sw' | undefined

    const ctx: any = {
      getController: () => ({hardReload}),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/templates/react/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: (reason?: 'manifest' | 'locales' | 'sw') => {
        pendingReason = reason
      },
      getPendingReloadReason: () => pendingReason,
      clearPendingReloadReason: () => {
        pendingReason = undefined
      }
    }

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(7000)
    const plugin = new ChromiumHardReloadPlugin({watchSource: true}, ctx)
    plugin.apply(compiler)
    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>([
          '/project/templates/react/src/manifest.json'
        ])
      },
      () => {}
    )

    const stats = {
      hasErrors: () => false,
      compilation: {
        assets: {
          'manifest.json': {
            source: () => JSON.stringify({})
          }
        },
        entrypoints: new Map(),
        chunkGraph: {}
      },
      toJson: () => ({assets: []})
    }
    await (doneHandler as any)(stats)
    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>([
          '/project/templates/react/src/manifest.json'
        ])
      },
      () => {}
    )
    await (doneHandler as any)(stats)

    expect(hardReload).toHaveBeenCalledTimes(1)
    expect(
      consoleLogSpy.mock.calls.some((call) =>
        String(call?.[0] || '').includes('"action":"extension_reload"')
      )
    ).toBe(true)
    consoleLogSpy.mockRestore()
  })

  it('does not trigger hard reload for manifest changes outside compiler context', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler: ((stats: any) => Promise<void>) | undefined

    const compiler: any = {
      options: {context: '/project/templates/react'},
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
    let pendingReason: 'manifest' | 'locales' | 'sw' | undefined

    const ctx: any = {
      getController: () => ({hardReload}),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/templates/react/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: (reason?: 'manifest' | 'locales' | 'sw') => {
        pendingReason = reason
      },
      getPendingReloadReason: () => pendingReason,
      clearPendingReloadReason: () => {
        pendingReason = undefined
      }
    }

    const plugin = new ChromiumHardReloadPlugin({}, ctx)
    plugin.apply(compiler)
    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>([
          '/project/other-ext/src/manifest.json',
          '/project/templates/react/src/background.ts'
        ])
      },
      () => {}
    )

    await (doneHandler as any)({
      hasErrors: () => false,
      compilation: {
        assets: {
          'manifest.json': {
            source: () => JSON.stringify({})
          }
        },
        entrypoints: new Map(),
        chunkGraph: {}
      },
      toJson: () => ({assets: []})
    })

    expect(hardReload).not.toHaveBeenCalled()
  })

  it('does not trigger hard reload on initial successful build with manifest pending reason', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler: ((stats: any) => Promise<void>) | undefined

    const compiler: any = {
      options: {context: '/project/templates/react'},
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
    let pendingReason: 'manifest' | 'locales' | 'sw' | undefined
    const ctx: any = {
      getController: () => ({hardReload}),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/templates/react/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: (reason?: 'manifest' | 'locales' | 'sw') => {
        pendingReason = reason
      },
      getPendingReloadReason: () => pendingReason,
      clearPendingReloadReason: () => {
        pendingReason = undefined
      }
    }

    const plugin = new ChromiumHardReloadPlugin({}, ctx)
    plugin.apply(compiler)
    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>([
          '/project/templates/react/src/manifest.json'
        ])
      },
      () => {}
    )

    await (doneHandler as any)({
      hasErrors: () => false,
      compilation: {
        assets: {
          'manifest.json': {
            source: () => JSON.stringify({})
          }
        },
        entrypoints: new Map(),
        chunkGraph: {}
      },
      toJson: () => ({assets: []})
    })

    expect(hardReload).not.toHaveBeenCalled()
  })

  it('does not trigger hard reload on initial successful build with service-worker pending reason', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler: ((stats: any) => Promise<void>) | undefined

    const compiler: any = {
      options: {context: '/project/templates/react'},
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
    let pendingReason: 'manifest' | 'locales' | 'sw' | undefined
    const ctx: any = {
      getController: () => ({hardReload}),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/templates/react/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({
        absolutePath:
          '/project/templates/react/src/background/service-worker.ts'
      }),
      setPendingReloadReason: (reason?: 'manifest' | 'locales' | 'sw') => {
        pendingReason = reason
      },
      getPendingReloadReason: () => pendingReason,
      clearPendingReloadReason: () => {
        pendingReason = undefined
      }
    }

    const plugin = new ChromiumHardReloadPlugin({}, ctx)
    plugin.apply(compiler)
    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>([
          '/project/templates/react/src/background/service-worker.ts'
        ])
      },
      () => {}
    )

    await (doneHandler as any)({
      hasErrors: () => false,
      compilation: {
        assets: {
          'manifest.json': {
            source: () => JSON.stringify({})
          }
        },
        entrypoints: new Map(),
        chunkGraph: {}
      },
      toJson: () => ({assets: []})
    })

    expect(hardReload).not.toHaveBeenCalled()
  })

  it('skips early reload attempts during startup cooldown window', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler: ((stats: any) => Promise<void>) | undefined

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }
    const compiler: any = {
      options: {context: '/project/templates/react'},
      getInfrastructureLogger: () => logger,
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
    let pendingReason: 'manifest' | 'locales' | 'sw' | undefined
    const ctx: any = {
      getController: () => ({hardReload}),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/templates/react/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: (reason?: 'manifest' | 'locales' | 'sw') => {
        pendingReason = reason
      },
      getPendingReloadReason: () => pendingReason,
      clearPendingReloadReason: () => {
        pendingReason = undefined
      }
    }

    const plugin = new ChromiumHardReloadPlugin({}, ctx)
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(2000)
    plugin.apply(compiler)

    const stats = {
      hasErrors: () => false,
      compilation: {
        assets: {
          'manifest.json': {
            source: () => JSON.stringify({})
          }
        },
        entrypoints: new Map(),
        chunkGraph: {}
      },
      toJson: () => ({assets: []})
    }

    await (doneHandler as any)(stats)
    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>([
          '/project/templates/react/src/manifest.json'
        ])
      },
      () => {}
    )
    await (doneHandler as any)(stats)

    expect(hardReload).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      '[reload] skipping early reload during startup cooldown (reason:manifest)'
    )
  })

  it('falls back to manifest source signatures when watchRun only reports the project root', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler: ((stats: any) => Promise<void>) | undefined

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-manifest-'))
    const manifestPath = path.join(tempRoot, 'src', 'manifest.json')
    fs.mkdirSync(path.dirname(manifestPath), {recursive: true})
    fs.writeFileSync(manifestPath, JSON.stringify({name: 'before'}, null, 2))

    try {
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      }

      const compiler: any = {
        options: {context: tempRoot},
        getInfrastructureLogger: () => logger,
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
      let pendingReason: 'manifest' | 'locales' | 'sw' | undefined
      const ctx: any = {
        getController: () => ({
          hardReload,
          getDeveloperModeStatus: () => 'enabled'
        }),
        onControllerReady: () => {},
        setController: () => {},
        getPorts: () => ({}),
        getExtensionRoot: () => path.join(tempRoot, 'dist', 'chromium'),
        setExtensionRoot: () => {},
        setServiceWorkerPaths: () => {},
        getServiceWorkerPaths: () => ({}),
        setPendingReloadReason: (reason?: 'manifest' | 'locales' | 'sw') => {
          pendingReason = reason
        },
        getPendingReloadReason: () => pendingReason,
        clearPendingReloadReason: () => {
          pendingReason = undefined
        }
      }

      const plugin = new ChromiumHardReloadPlugin({}, ctx)
      vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(7000)
      plugin.apply(compiler)

      const stats = {
        hasErrors: () => false,
        compilation: {
          assets: {
            'manifest.json': {
              source: () => JSON.stringify({})
            }
          },
          getAssets: () => [],
          entrypoints: new Map(),
          chunkGraph: {}
        }
      }

      await (doneHandler as any)(stats)

      fs.writeFileSync(
        manifestPath,
        JSON.stringify({name: 'after'}, null, 2),
        'utf8'
      )

      ;(watchRunHandler as any)(
        {
          modifiedFiles: new Set<string>([tempRoot])
        },
        () => {}
      )
      await (doneHandler as any)(stats)

      expect(hardReload).toHaveBeenCalledTimes(1)
      expect(logger.info).toHaveBeenCalledWith(
        '[reload] reloading extension (reason:manifest)'
      )
    } finally {
      fs.rmSync(tempRoot, {recursive: true, force: true})
    }
  })

  it('falls back to locale source signatures when watchRun only reports the project root', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler: ((stats: any) => Promise<void>) | undefined

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-locales-'))
    const localePath = path.join(
      tempRoot,
      'src',
      '_locales',
      'en',
      'messages.json'
    )
    fs.mkdirSync(path.dirname(localePath), {recursive: true})
    fs.writeFileSync(
      localePath,
      JSON.stringify({greeting: {message: 'before'}}, null, 2),
      'utf8'
    )

    try {
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      }

      const compiler: any = {
        options: {context: tempRoot},
        getInfrastructureLogger: () => logger,
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
      let pendingReason: 'manifest' | 'locales' | 'sw' | undefined
      const ctx: any = {
        getController: () => ({
          hardReload,
          getDeveloperModeStatus: () => 'enabled'
        }),
        onControllerReady: () => {},
        setController: () => {},
        getPorts: () => ({}),
        getExtensionRoot: () => path.join(tempRoot, 'dist', 'chromium'),
        setExtensionRoot: () => {},
        setServiceWorkerPaths: () => {},
        getServiceWorkerPaths: () => ({}),
        setPendingReloadReason: (reason?: 'manifest' | 'locales' | 'sw') => {
          pendingReason = reason
        },
        getPendingReloadReason: () => pendingReason,
        clearPendingReloadReason: () => {
          pendingReason = undefined
        }
      }

      const plugin = new ChromiumHardReloadPlugin({}, ctx)
      vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(7000)
      plugin.apply(compiler)

      const stats = {
        hasErrors: () => false,
        compilation: {
          assets: {
            'manifest.json': {
              source: () => JSON.stringify({})
            }
          },
          getAssets: () => [],
          entrypoints: new Map(),
          chunkGraph: {}
        }
      }

      await (doneHandler as any)(stats)

      fs.writeFileSync(
        localePath,
        JSON.stringify({greeting: {message: 'after'}}, null, 2),
        'utf8'
      )

      ;(watchRunHandler as any)(
        {
          modifiedFiles: new Set<string>([tempRoot])
        },
        () => {}
      )
      await (doneHandler as any)(stats)

      expect(hardReload).toHaveBeenCalledTimes(1)
      expect(logger.info).toHaveBeenCalledWith(
        '[reload] reloading extension (reason:locales)'
      )
    } finally {
      fs.rmSync(tempRoot, {recursive: true, force: true})
    }
  })

  it('falls back to service-worker source signatures when watchRun only reports the project root', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler: ((stats: any) => Promise<void>) | undefined

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-sw-'))
    const serviceWorkerPath = path.join(tempRoot, 'src', 'background.ts')
    fs.mkdirSync(path.dirname(serviceWorkerPath), {recursive: true})
    fs.writeFileSync(serviceWorkerPath, 'console.log("before")\n', 'utf8')

    try {
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      }

      const compiler: any = {
        options: {context: tempRoot},
        getInfrastructureLogger: () => logger,
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
      let pendingReason: 'manifest' | 'locales' | 'sw' | undefined
      const ctx: any = {
        getController: () => ({
          hardReload,
          getDeveloperModeStatus: () => 'enabled'
        }),
        onControllerReady: () => {},
        setController: () => {},
        getPorts: () => ({}),
        getExtensionRoot: () => path.join(tempRoot, 'dist', 'chromium'),
        setExtensionRoot: () => {},
        setServiceWorkerPaths: () => {},
        getServiceWorkerPaths: () => ({
          absolutePath: serviceWorkerPath
        }),
        setPendingReloadReason: (reason?: 'manifest' | 'locales' | 'sw') => {
          pendingReason = reason
        },
        getPendingReloadReason: () => pendingReason,
        clearPendingReloadReason: () => {
          pendingReason = undefined
        }
      }

      const plugin = new ChromiumHardReloadPlugin({}, ctx)
      vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(7000)
      plugin.apply(compiler)

      const serviceWorkerChunk = {id: 'sw-chunk'}
      const stats = {
        hasErrors: () => false,
        compilation: {
          assets: {
            'manifest.json': {
              source: () =>
                JSON.stringify({
                  background: {service_worker: 'background/service_worker.js'}
                })
            }
          },
          getAssets: () => [],
          entrypoints: new Map([
            [
              'background/service_worker',
              {
                chunks: new Set([serviceWorkerChunk])
              }
            ]
          ]),
          chunkGraph: {
            getChunkModulesIterable: (chunk: any) => {
              if (chunk !== serviceWorkerChunk) return []
              return [{resource: serviceWorkerPath}]
            }
          }
        }
      }

      await (doneHandler as any)(stats)

      fs.writeFileSync(serviceWorkerPath, 'console.log("after")\n', 'utf8')

      ;(watchRunHandler as any)(
        {
          modifiedFiles: new Set<string>([tempRoot])
        },
        () => {}
      )
      await (doneHandler as any)(stats)

      expect(hardReload).toHaveBeenCalledTimes(1)
      expect(logger.info).toHaveBeenCalledWith(
        '[reload] reloading extension (reason:sw)'
      )
    } finally {
      fs.rmSync(tempRoot, {recursive: true, force: true})
    }
  })

  it('prefers extension-runtime reinjection and skips direct fallback when runtime recovery succeeds', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler: ((stats: any) => Promise<void>) | undefined

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }

    const compiler: any = {
      options: {context: '/project/templates/react'},
      getInfrastructureLogger: () => logger,
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
    const reinjectMatchingTabsViaExtensionRuntime = vi.fn(async () => 1)
    const reloadMatchingTabsForContentScripts = vi.fn(async () => 1)
    let pendingReason: 'manifest' | 'locales' | 'sw' | undefined

    const ctx: any = {
      getController: () => ({
        hardReload,
        reinjectMatchingTabsViaExtensionRuntime,
        reloadMatchingTabsForContentScripts,
        getDeveloperModeStatus: () => 'enabled'
      }),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/templates/react/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: (reason?: 'manifest' | 'locales' | 'sw') => {
        pendingReason = reason
      },
      getPendingReloadReason: () => pendingReason,
      clearPendingReloadReason: () => {
        pendingReason = undefined
      }
    }

    const plugin = new ChromiumHardReloadPlugin({}, ctx)
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(7000)
    plugin.apply(compiler)

    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>([
          '/project/templates/react/src/manifest.json'
        ])
      },
      () => {}
    )

    const stats = {
      hasErrors: () => false,
      compilation: {
        getAsset: (name: string) =>
          name === 'manifest.json'
            ? {
                source: {
                  source: () =>
                    JSON.stringify({
                      content_scripts: [
                        {
                          matches: ['https://example.com/*'],
                          js: ['content_scripts/content-0.js']
                        }
                      ]
                    })
                }
              }
            : undefined,
        assets: {
          'manifest.json': {
            source: () =>
              JSON.stringify({
                content_scripts: [
                  {
                    matches: ['https://example.com/*'],
                    js: ['content_scripts/content-0.js']
                  }
                ]
              })
          }
        },
        entrypoints: new Map(),
        chunkGraph: {}
      },
      toJson: () => ({assets: []})
    }

    await (doneHandler as any)(stats)
    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>([
          '/project/templates/react/src/manifest.json'
        ])
      },
      () => {}
    )
    await (doneHandler as any)(stats)

    expect(hardReload).toHaveBeenCalledTimes(1)
    expect(reinjectMatchingTabsViaExtensionRuntime).toHaveBeenCalledTimes(1)
    expect(reloadMatchingTabsForContentScripts).toHaveBeenCalledTimes(1)
    expect(reloadMatchingTabsForContentScripts).toHaveBeenCalledWith(
      expect.any(Array),
      {preferPageReload: true}
    )
  })

  it('logs the runtime reinjection report before falling back to direct reinjection', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler: ((stats: any) => Promise<void>) | undefined

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }

    const compiler: any = {
      options: {context: '/project/templates/react'},
      getInfrastructureLogger: () => logger,
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
    const reinjectMatchingTabsViaExtensionRuntime = vi.fn(async () => 0)
    const reloadMatchingTabsForContentScripts = vi.fn(async () => 1)
    let pendingReason: 'manifest' | 'locales' | 'sw' | undefined

    const ctx: any = {
      getController: () => ({
        hardReload,
        reinjectMatchingTabsViaExtensionRuntime,
        reloadMatchingTabsForContentScripts,
        getLastRuntimeReinjectionReport: () => ({
          phase: 'evaluated',
          result: {reinjectedTabs: 0, hasRuntime: false, hasScripting: false}
        }),
        getDeveloperModeStatus: () => 'enabled'
      }),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/templates/react/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: (reason?: 'manifest' | 'locales' | 'sw') => {
        pendingReason = reason
      },
      getPendingReloadReason: () => pendingReason,
      clearPendingReloadReason: () => {
        pendingReason = undefined
      }
    }

    const plugin = new ChromiumHardReloadPlugin({}, ctx)
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(7000)
    plugin.apply(compiler)

    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>([
          '/project/templates/react/src/manifest.json'
        ])
      },
      () => {}
    )

    const stats = {
      hasErrors: () => false,
      compilation: {
        getAsset: (name: string) =>
          name === 'manifest.json'
            ? {
                source: {
                  source: () =>
                    JSON.stringify({
                      content_scripts: [
                        {
                          matches: ['https://example.com/*'],
                          js: ['content_scripts/content-0.js']
                        }
                      ]
                    })
                }
              }
            : undefined,
        assets: {
          'manifest.json': {
            source: () =>
              JSON.stringify({
                content_scripts: [
                  {
                    matches: ['https://example.com/*'],
                    js: ['content_scripts/content-0.js']
                  }
                ]
              })
          }
        },
        entrypoints: new Map(),
        chunkGraph: {}
      },
      toJson: () => ({assets: []})
    }

    await (doneHandler as any)(stats)
    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>([
          '/project/templates/react/src/manifest.json'
        ])
      },
      () => {}
    )
    await (doneHandler as any)(stats)

    expect(hardReload).toHaveBeenCalledTimes(1)
    expect(reinjectMatchingTabsViaExtensionRuntime).toHaveBeenCalledTimes(3)
    expect(reloadMatchingTabsForContentScripts).toHaveBeenCalledTimes(2)
    expect(reloadMatchingTabsForContentScripts).toHaveBeenNthCalledWith(
      1,
      expect.any(Array),
      {allowCoarseCleanup: false}
    )
    expect(reloadMatchingTabsForContentScripts).toHaveBeenNthCalledWith(
      2,
      expect.any(Array),
      {preferPageReload: true}
    )
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('extension-runtime reinjection report:')
    )
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('"hasScripting":false')
    )
  })
})
