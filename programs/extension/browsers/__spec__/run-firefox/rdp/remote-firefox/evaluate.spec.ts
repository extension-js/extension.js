import {EventEmitter} from 'node:events'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {evaluate} from '../../../../run-firefox/rdp/remote-firefox/evaluate'

type RdpClient = Parameters<typeof evaluate>[0]

// The request fields these fake clients read.
interface EvalRequest {
  type?: string
  to?: string
  text?: string
}

function asClient(client: EventEmitter): RdpClient {
  return client as unknown as RdpClient
}

class MockRdpClient extends EventEmitter {
  async request(payload: EvalRequest): Promise<unknown> {
    if (payload.type === 'evaluateJSAsync') {
      const resultID = `result-${String(payload.text).length}`
      queueMicrotask(() => {
        this.emit('message', {
          type: 'evaluationResult',
          resultID,
          result: String(payload.text).includes('outerHTML')
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
      evaluate(asClient(client), 'console-actor', 'location.href')
    ).resolves.toBe('async-value')
  })

  it('falls back when evaluateJSAsync times out', async () => {
    vi.useFakeTimers()

    class TimeoutFallbackClient extends EventEmitter {
      requests: EvalRequest[] = []

      async request(payload: EvalRequest): Promise<unknown> {
        this.requests.push(payload)

        if (payload.type === 'evaluateJSAsync') {
          return {resultID: 'timed-out-result', from: payload.to}
        }

        if (payload.type === 'evalWithOptions') {
          return {
            result: String(payload.text).includes('outerHTML')
              ? '<html><body>ok</body></html>'
              : 'fallback-value'
          }
        }

        throw new Error(`unexpected request type: ${String(payload.type)}`)
      }
    }

    const client = new TimeoutFallbackClient()
    const valuePromise = evaluate(
      asClient(client),
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
