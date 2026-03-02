import {beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  checkChromeRemoteDebuggingMock: vi.fn(async () => true),
  cdpCtorMock: vi.fn(),
  connectMock: vi.fn(),
  sendCommandMock: vi.fn(),
  disconnectMock: vi.fn()
}))

vi.mock('../../run-chromium/chromium-source-inspection/discovery', () => ({
  checkChromeRemoteDebugging: mocks.checkChromeRemoteDebuggingMock
}))

vi.mock('../../run-chromium/chromium-source-inspection/cdp-client', () => {
  class CDPClient {
    constructor(...args: unknown[]) {
      mocks.cdpCtorMock(...args)
    }
    connect = mocks.connectMock
    sendCommand = mocks.sendCommandMock
    disconnect = mocks.disconnectMock
  }
  return {CDPClient}
})

import {connectToChromeCdp} from '../../run-chromium/chromium-source-inspection/cdp-extension-controller/connect'

describe('connectToChromeCdp', () => {
  beforeEach(() => {
    mocks.checkChromeRemoteDebuggingMock.mockReset()
    mocks.cdpCtorMock.mockReset()
    mocks.connectMock.mockReset()
    mocks.sendCommandMock.mockReset()
    mocks.disconnectMock.mockReset()

    mocks.checkChromeRemoteDebuggingMock.mockResolvedValue(true)
    mocks.connectMock.mockResolvedValue(undefined)
    mocks.sendCommandMock.mockResolvedValue({})
  })

  it('retries bootstrap when early socket churn closes CDP before auto-attach', async () => {
    mocks.sendCommandMock
      .mockRejectedValueOnce(new Error('WebSocket is not open'))
      .mockResolvedValue({})

    await connectToChromeCdp(9222)

    expect(mocks.connectMock).toHaveBeenCalledTimes(2)
    expect(mocks.disconnectMock).toHaveBeenCalledTimes(1)
    expect(mocks.sendCommandMock).toHaveBeenCalledWith(
      'Target.setDiscoverTargets',
      {
        discover: true
      }
    )
    expect(mocks.sendCommandMock).toHaveBeenCalledWith('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true
    })
  })

  it('does not retry non-recoverable bootstrap failures', async () => {
    mocks.connectMock.mockRejectedValueOnce(
      new Error('certificate validation failed')
    )

    await expect(connectToChromeCdp(9222)).rejects.toThrow(
      'certificate validation failed'
    )
    expect(mocks.connectMock).toHaveBeenCalledTimes(1)
  })
})
