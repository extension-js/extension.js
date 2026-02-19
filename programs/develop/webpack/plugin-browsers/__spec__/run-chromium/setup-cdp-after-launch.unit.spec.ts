import {beforeEach, describe, expect, it, vi} from 'vitest'

const ctorSpy = vi.fn()
const connectSpy = vi.fn(async () => {})
const ensureLoadedSpy = vi.fn(async () => ({
  extensionId: 'user-ext-id',
  name: 'User Extension',
  version: '1.0.0'
}))
const getInfoBestEffortSpy = vi.fn(async () => ({
  extensionId: 'user-ext-id',
  name: 'User Extension',
  version: '1.0.0'
}))

vi.mock(
  '../../run-chromium/chromium-source-inspection/cdp-extension-controller',
  () => {
    class CDPExtensionController {
      constructor(args: any) {
        ctorSpy(args)
      }
      connect = connectSpy
      ensureLoaded = ensureLoadedSpy
      getInfoBestEffort = getInfoBestEffortSpy
    }
    return {CDPExtensionController}
  }
)

vi.mock('../../browsers-lib/shared-utils', () => ({
  deriveDebugPortWithInstance: vi.fn(() => 9333)
}))

vi.mock('../../browsers-lib/banner', () => ({
  printDevBannerOnce: vi.fn(async () => true),
  printProdBannerOnce: vi.fn(async () => true)
}))

import {setupCdpAfterLaunch} from '../../run-chromium/chromium-launch/setup-cdp-after-launch'
import * as banner from '../../browsers-lib/banner'

describe('setupCdpAfterLaunch', () => {
  beforeEach(() => {
    ctorSpy.mockClear()
    connectSpy.mockClear()
    ensureLoadedSpy.mockClear()
    getInfoBestEffortSpy.mockClear()
    vi.mocked(banner.printDevBannerOnce).mockClear()
    vi.mocked(banner.printProdBannerOnce).mockClear()
  })

  it('prints development banner early using best-effort info lookup', async () => {
    const printDevBannerOnceSpy = vi.mocked(banner.printDevBannerOnce)

    const plugin: any = {
      browser: 'chromium',
      port: 9333,
      instanceId: 'test-instance',
      browserVersionLine: 'Chromium 123'
    }

    const userExtensionPath = '/workspace/templates/react/dist/chromium'
    const chromiumArgs = [
      '--load-extension=/workspace/programs/develop/dist/extension-js-devtools/chromium,/workspace/programs/develop/dist/extension-js-theme/chromium,/workspace/templates/react/dist/chromium',
      '--remote-debugging-port=9333',
      '--user-data-dir=/tmp/extension-profile'
    ]

    const compilation: any = {
      options: {mode: 'development', output: {path: userExtensionPath}}
    }

    await setupCdpAfterLaunch(compilation, plugin, chromiumArgs)

    expect(printDevBannerOnceSpy).toHaveBeenCalled()
    const firstCallArgs = printDevBannerOnceSpy.mock.calls[0]?.[0] as
      | {browser?: string; outPath?: string; getInfo?: () => Promise<unknown>}
      | undefined
    expect(firstCallArgs).toMatchObject({
      browser: 'chromium',
      outPath: userExtensionPath
    })
    await firstCallArgs?.getInfo?.()
    expect(getInfoBestEffortSpy).toHaveBeenCalledTimes(1)
  })

  it('passes only selected user extension path to controller from --load-extension', async () => {
    const plugin: any = {
      browser: 'chromium',
      port: 9333,
      instanceId: 'test-instance',
      browserVersionLine: 'Chromium 123'
    }

    const userExtensionPath = '/workspace/templates/react/dist/chromium'
    const chromiumArgs = [
      '--load-extension=/workspace/programs/develop/dist/extension-js-devtools/chromium,/workspace/programs/develop/dist/extension-js-theme/chromium,/workspace/templates/react/dist/chromium',
      '--remote-debugging-port=9333',
      '--user-data-dir=/tmp/extension-profile'
    ]

    const compilation: any = {
      options: {mode: 'development', output: {path: userExtensionPath}}
    }

    await setupCdpAfterLaunch(compilation, plugin, chromiumArgs)

    expect(ctorSpy).toHaveBeenCalledTimes(1)
    expect(ctorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        outPath: userExtensionPath,
        extensionPaths: [userExtensionPath],
        profilePath: '/tmp/extension-profile',
        cdpPort: 9333
      })
    )
    expect(plugin.cdpController).toBeDefined()
  })
})
