import {EventEmitter} from 'events'
import {describe, expect, it, vi, afterEach} from 'vitest'
import {
  navigateViaScript,
  waitForPageReady
} from '../../../../run-firefox/firefox-source-inspection/remote-firefox/rdp-api'

class MockTransport extends EventEmitter {
  requests: any[] = []

  async request(payload: any): Promise<unknown> {
    this.requests.push(payload)
    if (
      payload.type !== 'evaluateJSAsync' &&
      payload.type !== 'evalWithOptions' &&
      payload.type !== 'evaluateJS' &&
      payload.type !== 'eval'
    ) {
      throw new Error(`unexpected request type: ${String(payload.type)}`)
    }

    const resultID = `req-${this.requests.length}`
    if (payload.type === 'evaluateJSAsync') {
      queueMicrotask(() => {
        this.emit('message', {
          type: 'evaluationResult',
          resultID,
          result: payload.text.includes('document.readyState')
            ? JSON.stringify({
                href: 'https://example.com/page',
                ready: 'complete'
              })
            : true
        })
      })
      return {resultID, from: payload.to}
    }

    return {
      result: payload.text.includes('document.readyState')
        ? JSON.stringify({
            href: 'https://example.com/page',
            ready: 'complete'
          })
        : true
    }
  }
}

class FallbackTransport extends EventEmitter {
  requests: any[] = []

  async request(payload: any): Promise<unknown> {
    this.requests.push(payload)
    if (payload.type === 'evaluateJSAsync') {
      throw new Error('async evaluation unavailable')
    }
    if (payload.type === 'evalWithOptions') {
      return {
        result: payload.text.includes('document.readyState')
          ? JSON.stringify({
              href: 'https://example.com/page',
              ready: 'complete'
            })
          : true
      }
    }
    throw new Error(`unexpected request type: ${String(payload.type)}`)
  }
}

describe('remote-firefox rdp api', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('navigates via async evaluation packets', async () => {
    const transport = new MockTransport()

    await navigateViaScript(
      transport as any,
      'console-actor',
      'https://example.com'
    )

    expect(transport.requests).toHaveLength(1)
    expect(transport.requests[0]).toMatchObject({
      to: 'console-actor',
      type: 'evaluateJSAsync'
    })
    const text = String(transport.requests[0].text)
    expect(text).toContain('window.location.assign(atob(')
    expect(text).toContain(
      Buffer.from('https://example.com/').toString('base64')
    )
  })

  it('waits for page readiness from async evaluation results', async () => {
    const transport = new MockTransport()
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    await waitForPageReady(
      transport as any,
      'console-actor',
      'https://example.com',
      1000
    )

    expect(transport.requests[0]).toMatchObject({
      to: 'console-actor',
      type: 'evaluateJSAsync'
    })
    expect(String(transport.requests[0].text)).toContain('document.readyState')
    timeoutSpy.mockRestore()
  })

  it('falls back to non-async evaluation packets when async evaluation fails', async () => {
    const transport = new FallbackTransport()

    await navigateViaScript(
      transport as any,
      'console-actor',
      'https://example.com'
    )
    await waitForPageReady(
      transport as any,
      'console-actor',
      'https://example.com',
      1000
    )

    expect(transport.requests[0]).toMatchObject({
      to: 'console-actor',
      type: 'evaluateJSAsync'
    })
    expect(transport.requests[1]).toMatchObject({
      to: 'console-actor',
      type: 'evalWithOptions'
    })
    expect(
      transport.requests.some((request) => request.type === 'evalWithOptions')
    ).toBe(true)
  })

  it('falls back to non-async evaluation packets when async evaluation times out', async () => {
    vi.useFakeTimers()

    class TimeoutFallbackTransport extends EventEmitter {
      requests: any[] = []

      async request(payload: any): Promise<unknown> {
        this.requests.push(payload)
        if (payload.type === 'evaluateJSAsync') {
          return {resultID: 'timed-out-result', from: payload.to}
        }
        if (payload.type === 'evalWithOptions') {
          return {
            result: payload.text.includes('document.readyState')
              ? JSON.stringify({
                  href: 'https://example.com/page',
                  ready: 'complete'
                })
              : true
          }
        }
        throw new Error(`unexpected request type: ${String(payload.type)}`)
      }
    }

    const transport = new TimeoutFallbackTransport()
    const navigation = navigateViaScript(
      transport as any,
      'console-actor',
      'https://example.com'
    )
    await vi.advanceTimersByTimeAsync(8001)
    await navigation

    const ready = waitForPageReady(
      transport as any,
      'console-actor',
      'https://example.com',
      1000
    )
    await vi.advanceTimersByTimeAsync(8001)
    await ready

    expect(
      transport.requests.some((request) => request.type === 'evalWithOptions')
    ).toBe(true)
  })
})
