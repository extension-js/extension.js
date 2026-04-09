import {EventEmitter} from 'events'
import {describe, expect, it, vi, afterEach} from 'vitest'
import {
  evaluate,
  evaluateRaw,
  serializeDocument
} from '../../../../run-firefox/firefox-source-inspection/remote-firefox/evaluate'

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

  it('returns raw evaluationResult payload for evaluateRaw', async () => {
    const client = new MockRdpClient()

    await expect(
      evaluateRaw(client as any, 'console-actor', 'document.title')
    ).resolves.toMatchObject({
      type: 'evaluationResult',
      result: 'async-value'
    })
  })

  it('serializes documents through async evaluation', async () => {
    const client = new MockRdpClient()

    await expect(
      serializeDocument(client as any, 'console-actor')
    ).resolves.toBe('<html><body>ok</body></html>')
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

    const rawPromise = evaluateRaw(
      client as any,
      'console-actor',
      'document.title'
    )
    await vi.advanceTimersByTimeAsync(8001)
    await expect(rawPromise).resolves.toMatchObject({
      result: 'fallback-value'
    })

    const htmlPromise = serializeDocument(client as any, 'console-actor')
    await vi.advanceTimersByTimeAsync(8001)
    await expect(htmlPromise).resolves.toBe('<html><body>ok</body></html>')

    expect(
      client.requests.some((request) => request.type === 'evalWithOptions')
    ).toBe(true)
  })
})
