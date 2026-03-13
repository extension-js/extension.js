import {beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  connectToChromeCdpMock: vi.fn(),
  registerAutoEnableLoggingMock: vi.fn()
}))

vi.mock(
  '../../run-chromium/chromium-source-inspection/cdp-extension-controller/connect',
  () => ({
    connectToChromeCdp: mocks.connectToChromeCdpMock
  })
)

vi.mock(
  '../../run-chromium/chromium-source-inspection/cdp-extension-controller/logging',
  () => ({
    registerAutoEnableLogging: mocks.registerAutoEnableLoggingMock
  })
)

import {CDPExtensionController} from '../../run-chromium/chromium-source-inspection/cdp-extension-controller'

describe('CDPExtensionController hardReload', () => {
  beforeEach(() => {
    mocks.connectToChromeCdpMock.mockReset()
    mocks.registerAutoEnableLoggingMock.mockReset()
  })

  it('reconnects and retries reload when the existing CDP socket is dead', async () => {
    const initialCdp = {
      forceReloadExtension: vi.fn(async () => false),
      disconnect: vi.fn()
    }
    const reconnectedCdp = {
      sendCommand: vi.fn(async () => ({})),
      forceReloadExtension: vi.fn(async () => true),
      disconnect: vi.fn()
    }

    mocks.connectToChromeCdpMock.mockResolvedValue(reconnectedCdp)

    const controller = new CDPExtensionController({
      outPath: '/tmp/ext',
      browser: 'chrome',
      cdpPort: 9222
    }) as any

    controller.cdp = initialCdp
    controller.extensionId = 'ext-id'
    controller.deriveExtensionIdFromTargets = vi.fn(async () => 'ext-id')

    const ok = await controller.hardReload()

    expect(ok).toBe(true)
    expect(initialCdp.forceReloadExtension).toHaveBeenCalledWith('ext-id')
    expect(initialCdp.disconnect).toHaveBeenCalledTimes(1)
    expect(mocks.connectToChromeCdpMock).toHaveBeenCalledWith(9222)
    expect(reconnectedCdp.sendCommand).toHaveBeenCalledWith(
      'Target.setDiscoverTargets',
      {discover: true}
    )
    expect(reconnectedCdp.sendCommand).toHaveBeenCalledWith('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true
    })
    expect(reconnectedCdp.forceReloadExtension).toHaveBeenCalledWith('ext-id')
  })
})
