import {EventEmitter} from 'node:events'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {evaluate} from '../../../../run-firefox/rdp/remote-firefox/evaluate'

class MockRdpClient extends EventEmitter {
  async request(payload: any): Promise<unknown> {
    if (payload.type === 'evaluateJSAsync') {
      const resultID = `result-${String(payload.text).length}`
      queueMicrotask(() => {
        this.emit('message', {
          type: 'evaluationResult',
          resultID,
          result: payload.text.includes('outerHTML')
            ? '<html><body>ok</body></html>'
            : 'async-value'
        })
      })
      return {resultID, from: payload.to}
    }

    throw new Error(`unexpected request type: ${String(payload.type)}`)
  }
}

describe('remote-firefox evaluate helpers', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves evaluateJSAsync results from protocol events', async () => {
    const client = new MockRdpClient()

    await expect(
      evaluate(client as any, 'console-actor', 'location.href')
    ).resolves.toBe('async-value')
  })

  it('falls back when evaluateJSAsync times out', async () => {
    vi.useFakeTimers()

    class TimeoutFallbackClient extends EventEmitter {
      requests: any[] = []

      async request(payload: any): Promise<unknown> {
        this.requests.push(payload)
        if (payload.type === 'evaluateJSAsync') {
          return {resultID: 'timed-out-result', from: payload.to}
        }
        if (payload.type === 'evalWithOptions') {
          return {
            result: payload.text.includes('outerHTML')
              ? '<html><body>ok</body></html>'
              : 'fallback-value'
          }
        }
        throw new Error(`unexpected request type: ${String(payload.type)}`)
      }
    }

    const client = new TimeoutFallbackClient()
    const valuePromise = evaluate(
      client as any,
      'console-actor',
      'location.href'
    )
    await vi.advanceTimersByTimeAsync(8001)
    await expect(valuePromise).resolves.toBe('fallback-value')

    expect(
      client.requests.some((request) => request.type === 'evalWithOptions')
    ).toBe(true)
  })
})
