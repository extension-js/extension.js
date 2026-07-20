import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const constructorCalls: Array<{host: any; ctx: any}> = []

vi.mock('../run-chromium/chromium-launch', () => {
  class ChromiumLaunchPlugin {
    constructor(host: any, ctx: any) {
      constructorCalls.push({host, ctx})
    }
    async runOnce(_compilation: any, _options: any) {}
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
