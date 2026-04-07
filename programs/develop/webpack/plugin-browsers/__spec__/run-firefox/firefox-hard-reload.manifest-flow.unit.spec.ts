import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, expect, it, vi} from 'vitest'
import {FirefoxHardReloadPlugin} from '../../run-firefox/firefox-hard-reload'

describe('FirefoxHardReloadPlugin manifest hard reload flow', () => {
  it('triggers controller hardReload when manifest changes in current context', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler:
      | ((stats: any, done: () => void) => void | Promise<void>)
      | undefined

    const compiler: any = {
      options: {context: '/project/templates/react'},
      hooks: {
        watchRun: {
          tapAsync: (_name: string, handler: any) => {
            watchRunHandler = handler
          }
        },
        done: {
          tapAsync: (_name: string, handler: any) => {
            doneHandler = handler
          }
        }
      }
    }

    const hardReload = vi.fn(async () => {})
    let pendingReason: 'manifest' | 'locales' | 'sw' | undefined
    const ctx: any = {
      logger: {
        warn: vi.fn()
      },
      setPendingReloadReason: (reason?: 'manifest' | 'locales' | 'sw') => {
        pendingReason = reason
      },
      getPendingReloadReason: () => pendingReason,
      clearPendingReloadReason: () => {
        pendingReason = undefined
      },
      getExtensionRoot: vi.fn(() => '/project/dist/firefox')
    }

    const host: any = {
      browser: 'firefox',
      source: false,
      watchSource: false,
      rdpController: {
        hardReload
      }
    }

    const plugin = new FirefoxHardReloadPlugin(host, ctx)
    plugin.apply(compiler)

    const stats = {
      hasErrors: () => false,
      compilation: {
        getAssets: () => [],
        entrypoints: new Map(),
        chunkGraph: {}
      }
    }

    await new Promise<void>((resolve) => {
      ;(doneHandler as any)(stats, resolve)
    })

    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>([
          '/project/templates/react/src/manifest.json'
        ])
      },
      () => {}
    )

    await new Promise<void>((resolve) => {
      ;(doneHandler as any)(stats, resolve)
    })

    expect(hardReload).toHaveBeenCalledTimes(1)
    expect(hardReload).toHaveBeenCalledWith(stats.compilation, [])
    expect(pendingReason).toBeUndefined()
  })

  it('falls back to manifest source signatures when watchRun only reports the project root', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler:
      | ((stats: any, done: () => void) => void | Promise<void>)
      | undefined

    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'extjs-ff-manifest-')
    )
    const manifestPath = path.join(tempRoot, 'src', 'manifest.json')
    fs.mkdirSync(path.dirname(manifestPath), {recursive: true})
    fs.writeFileSync(manifestPath, JSON.stringify({name: 'before'}, null, 2))

    try {
      const compiler: any = {
        options: {context: tempRoot},
        hooks: {
          watchRun: {
            tapAsync: (_name: string, handler: any) => {
              watchRunHandler = handler
            }
          },
          done: {
            tapAsync: (_name: string, handler: any) => {
              doneHandler = handler
            }
          }
        }
      }

      const hardReload = vi.fn(async () => {})
      let pendingReason: 'manifest' | 'locales' | 'sw' | undefined
      const ctx: any = {
        logger: {
          warn: vi.fn()
        },
        setPendingReloadReason: (reason?: 'manifest' | 'locales' | 'sw') => {
          pendingReason = reason
        },
        getPendingReloadReason: () => pendingReason,
        clearPendingReloadReason: () => {
          pendingReason = undefined
        },
        getExtensionRoot: vi.fn(() => path.join(tempRoot, 'dist', 'firefox'))
      }

      const host: any = {
        browser: 'firefox',
        source: false,
        watchSource: false,
        rdpController: {
          hardReload
        }
      }

      const plugin = new FirefoxHardReloadPlugin(host, ctx)
      plugin.apply(compiler)

      const stats = {
        hasErrors: () => false,
        compilation: {
          getAssets: () => [],
          entrypoints: new Map(),
          chunkGraph: {}
        }
      }

      await new Promise<void>((resolve) => {
        ;(doneHandler as any)(stats, resolve)
      })

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

      await new Promise<void>((resolve) => {
        ;(doneHandler as any)(stats, resolve)
      })

      expect(hardReload).toHaveBeenCalledTimes(1)
      expect(pendingReason).toBeUndefined()
    } finally {
      fs.rmSync(tempRoot, {recursive: true, force: true})
    }
  })

  it('falls back to locale source signatures when watchRun only reports the project root', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler:
      | ((stats: any, done: () => void) => void | Promise<void>)
      | undefined

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ff-locales-'))
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
      const compiler: any = {
        options: {context: tempRoot},
        hooks: {
          watchRun: {
            tapAsync: (_name: string, handler: any) => {
              watchRunHandler = handler
            }
          },
          done: {
            tapAsync: (_name: string, handler: any) => {
              doneHandler = handler
            }
          }
        }
      }

      const hardReload = vi.fn(async () => {})
      let pendingReason: 'manifest' | 'locales' | 'sw' | undefined
      const ctx: any = {
        logger: {
          warn: vi.fn()
        },
        setPendingReloadReason: (reason?: 'manifest' | 'locales' | 'sw') => {
          pendingReason = reason
        },
        getPendingReloadReason: () => pendingReason,
        clearPendingReloadReason: () => {
          pendingReason = undefined
        },
        getExtensionRoot: vi.fn(() => path.join(tempRoot, 'dist', 'firefox'))
      }

      const host: any = {
        browser: 'firefox',
        source: false,
        watchSource: false,
        rdpController: {
          hardReload
        }
      }

      const plugin = new FirefoxHardReloadPlugin(host, ctx)
      plugin.apply(compiler)

      const stats = {
        hasErrors: () => false,
        compilation: {
          getAssets: () => [],
          entrypoints: new Map(),
          chunkGraph: {}
        }
      }

      await new Promise<void>((resolve) => {
        ;(doneHandler as any)(stats, resolve)
      })

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

      await new Promise<void>((resolve) => {
        ;(doneHandler as any)(stats, resolve)
      })

      expect(hardReload).toHaveBeenCalledTimes(1)
      expect(pendingReason).toBeUndefined()
    } finally {
      fs.rmSync(tempRoot, {recursive: true, force: true})
    }
  })

  it('falls back to service-worker source signatures when watchRun only reports the project root', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler:
      | ((stats: any, done: () => void) => void | Promise<void>)
      | undefined

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ff-sw-'))
    const serviceWorkerPath = path.join(tempRoot, 'src', 'background.ts')
    fs.mkdirSync(path.dirname(serviceWorkerPath), {recursive: true})
    fs.writeFileSync(serviceWorkerPath, 'console.log("before")\n', 'utf8')

    try {
      const compiler: any = {
        options: {context: tempRoot},
        hooks: {
          watchRun: {
            tapAsync: (_name: string, handler: any) => {
              watchRunHandler = handler
            }
          },
          done: {
            tapAsync: (_name: string, handler: any) => {
              doneHandler = handler
            }
          }
        }
      }

      const hardReload = vi.fn(async () => {})
      let pendingReason: 'manifest' | 'locales' | 'sw' | undefined
      const ctx: any = {
        logger: {
          warn: vi.fn()
        },
        setPendingReloadReason: (reason?: 'manifest' | 'locales' | 'sw') => {
          pendingReason = reason
        },
        getPendingReloadReason: () => pendingReason,
        clearPendingReloadReason: () => {
          pendingReason = undefined
        },
        getExtensionRoot: vi.fn(() => path.join(tempRoot, 'dist', 'firefox'))
      }

      const host: any = {
        browser: 'firefox',
        source: false,
        watchSource: false,
        rdpController: {
          hardReload
        }
      }

      const plugin = new FirefoxHardReloadPlugin(host, ctx)
      plugin.apply(compiler)

      const serviceWorkerChunk = {id: 'sw-chunk'}
      const stats = {
        hasErrors: () => false,
        compilation: {
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

      await new Promise<void>((resolve) => {
        ;(doneHandler as any)(stats, resolve)
      })

      fs.writeFileSync(serviceWorkerPath, 'console.log("after")\n', 'utf8')

      ;(watchRunHandler as any)(
        {
          modifiedFiles: new Set<string>([tempRoot])
        },
        () => {}
      )

      await new Promise<void>((resolve) => {
        ;(doneHandler as any)(stats, resolve)
      })

      expect(hardReload).toHaveBeenCalledTimes(1)
      expect(pendingReason).toBeUndefined()
    } finally {
      fs.rmSync(tempRoot, {recursive: true, force: true})
    }
  })

  it('falls back to emitted assets when watchRun does not provide a reason', async () => {
    let doneHandler:
      | ((stats: any, done: () => void) => void | Promise<void>)
      | undefined

    const compiler: any = {
      options: {context: '/project/templates/react'},
      hooks: {
        watchRun: {
          tapAsync: vi.fn()
        },
        done: {
          tapAsync: (_name: string, handler: any) => {
            doneHandler = handler
          }
        }
      }
    }

    const hardReload = vi.fn(async () => {})
    let pendingReason: 'manifest' | 'locales' | 'sw' | undefined
    const ctx: any = {
      logger: {
        warn: vi.fn()
      },
      setPendingReloadReason: (reason?: 'manifest' | 'locales' | 'sw') => {
        pendingReason = reason
      },
      getPendingReloadReason: () => pendingReason,
      clearPendingReloadReason: () => {
        pendingReason = undefined
      },
      getExtensionRoot: vi.fn(() => '/project/dist/firefox')
    }

    const host: any = {
      browser: 'firefox',
      source: false,
      watchSource: false,
      rdpController: {
        hardReload
      }
    }

    const plugin = new FirefoxHardReloadPlugin(host, ctx)
    plugin.apply(compiler)

    const firstStats = {
      hasErrors: () => false,
      compilation: {
        getAssets: () => [],
        entrypoints: new Map(),
        chunkGraph: {}
      }
    }

    await new Promise<void>((resolve) => {
      ;(doneHandler as any)(firstStats, resolve)
    })

    const secondStats = {
      hasErrors: () => false,
      compilation: {
        getAssets: () => [
          {name: 'background/service_worker.mjs', emitted: true},
          {name: 'manifest.json', emitted: true}
        ],
        entrypoints: new Map(),
        chunkGraph: {}
      }
    }

    await new Promise<void>((resolve) => {
      ;(doneHandler as any)(secondStats, resolve)
    })

    expect(hardReload).toHaveBeenCalledTimes(1)
    expect(hardReload).toHaveBeenCalledWith(secondStats.compilation, [
      'background/service_worker.mjs',
      'manifest.json'
    ])
    expect(pendingReason).toBeUndefined()
  })
})
