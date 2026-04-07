import {describe, expect, it, vi} from 'vitest'
import {FirefoxHardReloadPlugin} from '../../run-firefox/firefox-hard-reload'

describe('FirefoxHardReloadPlugin content-script reload flow', () => {
  it('keeps pending content entries until the settled follow-up build runs', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler:
      | ((stats: any, done: () => void) => void | Promise<void>)
      | undefined

    const compiler: any = {
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

    const reloadMatchingTabsForContentScripts = vi.fn(async () => 1)
    const hardReload = vi.fn(async () => {})

    const ctx: any = {
      logger: {
        warn: vi.fn()
      },
      setPendingReloadReason: vi.fn(),
      getPendingReloadReason: vi.fn(() => undefined),
      getExtensionRoot: vi.fn(() => '/project/dist/firefox')
    }

    const host: any = {
      browser: 'firefox',
      source: false,
      watchSource: false,
      rdpController: {
        hardReload,
        reloadMatchingTabsForContentScripts
      }
    }

    const plugin = new FirefoxHardReloadPlugin(host, ctx) as any
    plugin.hasSeenFirstSuccessfulDone = true
    plugin.contentReloadQuietPeriodMs = 0
    plugin.contentReloadFollowupMs = 0
    plugin.apply(compiler)

    plugin.contentScriptSourceDependencyPathsByEntry = new Map([
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
        getAssets: () => [],
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

    await new Promise<void>((resolve) => {
      ;(doneHandler as any)(stats, resolve)
    })

    expect(reloadMatchingTabsForContentScripts).toHaveBeenCalledTimes(1)
    expect(plugin.pendingContentReloadEntryNames).toEqual([
      'content_scripts/content-0'
    ])

    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>()
      },
      () => {}
    )

    await new Promise<void>((resolve) => {
      ;(doneHandler as any)(stats, resolve)
    })

    expect(reloadMatchingTabsForContentScripts).toHaveBeenCalledTimes(2)
    expect(plugin.pendingContentReloadEntryNames).toEqual([])
    expect(hardReload).not.toHaveBeenCalled()
  })

  it('ignores unrelated source edits that are not tracked as content script dependencies', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler:
      | ((stats: any, done: () => void) => void | Promise<void>)
      | undefined

    const compiler: any = {
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

    const reloadMatchingTabsForContentScripts = vi.fn(async () => 1)
    const hardReload = vi.fn(async () => {})

    const ctx: any = {
      logger: {
        warn: vi.fn()
      },
      setPendingReloadReason: vi.fn(),
      getPendingReloadReason: vi.fn(() => undefined),
      getExtensionRoot: vi.fn(() => '/project/dist/firefox')
    }

    const host: any = {
      browser: 'firefox',
      source: false,
      watchSource: false,
      rdpController: {
        hardReload,
        reloadMatchingTabsForContentScripts
      }
    }

    const plugin = new FirefoxHardReloadPlugin(host, ctx) as any
    plugin.hasSeenFirstSuccessfulDone = true
    plugin.contentReloadQuietPeriodMs = 0
    plugin.contentReloadFollowupMs = 0
    plugin.apply(compiler)

    plugin.contentScriptSourceDependencyPathsByEntry = new Map([
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
        getAssets: () => [],
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

    await new Promise<void>((resolve) => {
      ;(doneHandler as any)(stats, resolve)
    })

    expect(reloadMatchingTabsForContentScripts).not.toHaveBeenCalled()
    expect(hardReload).not.toHaveBeenCalled()
  })
})
