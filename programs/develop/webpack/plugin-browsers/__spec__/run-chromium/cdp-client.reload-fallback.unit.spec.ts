import {describe, it, expect, vi} from 'vitest'
import {CDPClient} from '../../run-chromium/chromium-source-inspection/cdp-client'

describe('CDPClient forceReloadExtension', () => {
  it('falls back to target evaluation when Extensions.reload is unavailable', async () => {
    const client = new CDPClient(9222, '127.0.0.1') as any
    const extensionId = 'homdjffbninahljjngkeelaniofgnela'
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const sendCommand = vi.fn(async (method: string) => {
      if (method === 'Extensions.reload') {
        throw new Error(
          JSON.stringify({
            code: -32601,
            message: "'Extensions.reload' wasn't found"
          })
        )
      }
      if (method === 'Runtime.enable') return {}
      if (method === 'Runtime.evaluate') return {result: {value: true}}
      return {}
    })

    client.sendCommand = sendCommand
    client.getTargets = vi.fn(async () => [
      {
        targetId: 'target-1',
        type: 'service_worker',
        url: `chrome-extension://${extensionId}/background.js`
      }
    ])
    client.attachToTarget = vi.fn(async () => 'session-1')

    const ok = await client.forceReloadExtension(extensionId)

    expect(ok).toBe(true)
    expect(sendCommand).toHaveBeenCalledWith('Extensions.reload', {
      extensionId,
      forceReload: true
    })
    expect(sendCommand).toHaveBeenCalledWith('Runtime.enable', {}, 'session-1')
    expect(sendCommand).toHaveBeenCalledWith(
      'Runtime.evaluate',
      expect.objectContaining({
        returnByValue: true
      }),
      'session-1'
    )
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
