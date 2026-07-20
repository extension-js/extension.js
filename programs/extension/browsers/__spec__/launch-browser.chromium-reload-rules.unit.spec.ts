import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// This spec guards the launched-Chromium controller contract: reload is owned
// by the dev server's control-bridge SW producer (the same executor as
// `--no-browser`), NOT the launcher's CDP controller. So launchBrowser()'s
// returned controller exposes logging only, no reload(), no close(). The
// reload routing itself is covered by the develop-side dispatchReload / broker
// tests.
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
    enableUnifiedLogging: vi.fn().mockResolvedValue(undefined)
  }

  function createChromiumContext() {
    return {
      getController: () => cdpController,
      setController: (_c: any) => {}
    }
  }

  return {createChromiumContext, __cdpController: cdpController}
})

import {launchBrowser} from '../index'

describe('launchBrowser (chromium): controller exposes logging only', () => {
  beforeEach(() => {
    constructorCalls.length = 0
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('does not expose a reload() method (reload is owned by the SW producer)', async () => {
    const controller = await launchBrowser({
      browser: 'chrome',
      outputPath: '/tmp/x',
      contextDir: '/tmp/x',
      extensionsToLoad: ['/tmp/ext'],
      mode: 'development',
      dryRun: true
    } as any)

    expect((controller as any).reload).toBeUndefined()
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
