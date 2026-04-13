import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

// This spec guards the invariant that launchBrowser()'s Chromium reload path
// converts canonical content-script entry names into ContentScriptTargetRule[]
// before delegating to the CDP controller. Passing raw entry strings through
// caused silent HMR failures because the controller expects the rule shape.
const constructorCalls: Array<{host: any; ctx: any}> = []

vi.mock('../run-chromium/chromium-launch', () => {
  class ChromiumLaunchPlugin {
    constructor(host: any, ctx: any) {
      constructorCalls.push({host, ctx})
    }
    async runOnce(_compilation: any, _options: any) {
      // no-op; dry-run semantics
    }
    apply(_compiler: any) {}
  }
  return {ChromiumLaunchPlugin}
})

vi.mock('../run-chromium/chromium-context', async () => {
  const cdpController = {
    hardReload: vi.fn().mockResolvedValue(undefined),
    reloadMatchingTabsForContentScripts: vi.fn().mockResolvedValue(0),
    enableUnifiedLogging: vi.fn().mockResolvedValue(undefined)
  }

  function createChromiumContext() {
    return {
      getController: () => cdpController,
      onControllerReady: (_cb: any) => {},
      setController: (_c: any, _p: any) => {},
      getPorts: () => ({}),
      setExtensionRoot: (_r?: string) => {},
      getExtensionRoot: () => undefined,
      setServiceWorkerPaths: (_r?: string, _a?: string) => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: (_r?: any) => {},
      getPendingReloadReason: () => undefined,
      clearPendingReloadReason: () => {},
      logger: undefined,
      didLaunch: false
    }
  }

  return {createChromiumContext, __cdpController: cdpController}
})

import {launchBrowser} from '../index'

describe('launchBrowser (chromium): reload entry→rule conversion', () => {
  beforeEach(() => {
    constructorCalls.length = 0
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('converts canonical content-script entry names into rules before delegating to the CDP controller', async () => {
    const extRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-cdp-reload-'))
    try {
      fs.writeFileSync(
        path.join(extRoot, 'manifest.json'),
        JSON.stringify({
          manifest_version: 3,
          name: 'cdp-reload-test',
          version: '0.0.0',
          content_scripts: [
            {matches: ['https://example.com/*'], js: ['content.js']},
            {matches: ['https://*.github.com/*'], js: ['gh.js']}
          ]
        }),
        'utf8'
      )

      const controller = await launchBrowser({
        browser: 'chrome',
        outputPath: extRoot,
        contextDir: extRoot,
        extensionsToLoad: [extRoot],
        mode: 'development',
        dryRun: true
      } as any)

      const mod: any = await import('../run-chromium/chromium-context')
      const cdp = mod.__cdpController

      await controller.reload({
        type: 'content-scripts',
        changedContentScriptEntries: ['content_scripts/content-1']
      })

      expect(cdp.reloadMatchingTabsForContentScripts).toHaveBeenCalledTimes(1)
      const callArg = cdp.reloadMatchingTabsForContentScripts.mock.calls[0][0]
      expect(Array.isArray(callArg)).toBe(true)
      expect(callArg).toHaveLength(1)
      expect(callArg[0]).toMatchObject({
        index: 1,
        matches: ['https://*.github.com/*']
      })
    } finally {
      fs.rmSync(extRoot, {recursive: true, force: true})
    }
  })

  it('does not expose a close() method on the returned controller', async () => {
    const controller = await launchBrowser({
      browser: 'chrome',
      outputPath: '/tmp/x',
      contextDir: '/tmp/x',
      extensionsToLoad: ['/tmp/ext'],
      mode: 'development',
      dryRun: true
    } as any)

    expect((controller as any).close).toBeUndefined()
  })
})
