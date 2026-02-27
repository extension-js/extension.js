import {afterEach, describe, expect, it, vi} from 'vitest'
import {ChromiumHardReloadPlugin} from '../../run-chromium/chromium-hard-reload'

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
    let pendingReason: 'manifest' | 'locales' | 'sw' | 'content' | undefined

    const ctx: any = {
      getController: () => ({hardReload}),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/templates/react/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: (
        reason?: 'manifest' | 'locales' | 'sw' | 'content'
      ) => {
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
    let pendingReason: 'manifest' | 'locales' | 'sw' | 'content' | undefined

    const ctx: any = {
      getController: () => ({hardReload}),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/templates/react/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: (
        reason?: 'manifest' | 'locales' | 'sw' | 'content'
      ) => {
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
    expect(logger.info).toHaveBeenCalledWith(
      '[reload] reloading extension (reason:manifest)'
    )
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
    let pendingReason: 'manifest' | 'locales' | 'sw' | 'content' | undefined

    const ctx: any = {
      getController: () => ({hardReload}),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/templates/react/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: (
        reason?: 'manifest' | 'locales' | 'sw' | 'content'
      ) => {
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
    expect(consoleLogSpy).toHaveBeenCalledTimes(1)
    expect(consoleLogSpy.mock.calls[0]?.[0]).toContain(
      '"action":"extension_reload"'
    )
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
    let pendingReason: 'manifest' | 'locales' | 'sw' | 'content' | undefined

    const ctx: any = {
      getController: () => ({hardReload}),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/templates/react/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: (
        reason?: 'manifest' | 'locales' | 'sw' | 'content'
      ) => {
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
    let pendingReason: 'manifest' | 'locales' | 'sw' | 'content' | undefined
    const ctx: any = {
      getController: () => ({hardReload}),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/templates/react/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: (
        reason?: 'manifest' | 'locales' | 'sw' | 'content'
      ) => {
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
    let pendingReason: 'manifest' | 'locales' | 'sw' | 'content' | undefined
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
      setPendingReloadReason: (
        reason?: 'manifest' | 'locales' | 'sw' | 'content'
      ) => {
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
    let pendingReason: 'manifest' | 'locales' | 'sw' | 'content' | undefined
    const ctx: any = {
      getController: () => ({hardReload}),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/templates/react/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: (
        reason?: 'manifest' | 'locales' | 'sw' | 'content'
      ) => {
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

  it('does not trigger hard reload on initial successful content-script emission', async () => {
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
          tapAsync: (_name: string, _handler: any) => {}
        },
        done: {
          tapPromise: (_name: string, handler: any) => {
            doneHandler = handler
          }
        }
      }
    }

    const hardReload = vi.fn(async () => true)
    let pendingReason: 'manifest' | 'locales' | 'sw' | 'content' | undefined
    const ctx: any = {
      getController: () => ({hardReload}),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/templates/react/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: (
        reason?: 'manifest' | 'locales' | 'sw' | 'content'
      ) => {
        pendingReason = reason
      },
      getPendingReloadReason: () => pendingReason,
      clearPendingReloadReason: () => {
        pendingReason = undefined
      }
    }

    const plugin = new ChromiumHardReloadPlugin({}, ctx)
    plugin.apply(compiler)

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
      toJson: () => ({
        assets: [{name: 'content_scripts/content-0.js', emitted: true}]
      })
    })

    expect(hardReload).not.toHaveBeenCalled()
  })

  it('triggers hard reload on content-script emission after initial successful build', async () => {
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
          tapAsync: (_name: string, _handler: any) => {}
        },
        done: {
          tapPromise: (_name: string, handler: any) => {
            doneHandler = handler
          }
        }
      }
    }

    const hardReload = vi.fn(async () => true)
    let pendingReason: 'manifest' | 'locales' | 'sw' | 'content' | undefined
    const ctx: any = {
      getController: () => ({hardReload}),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/templates/react/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: (
        reason?: 'manifest' | 'locales' | 'sw' | 'content'
      ) => {
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

    const contentStats = {
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
      toJson: () => ({
        assets: [{name: 'content_scripts/content-0.js', emitted: true}]
      })
    }

    await (doneHandler as any)(contentStats)
    await (doneHandler as any)(contentStats)

    expect(hardReload).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith(
      '[reload] reloading extension (reason:content)'
    )
  })
})
