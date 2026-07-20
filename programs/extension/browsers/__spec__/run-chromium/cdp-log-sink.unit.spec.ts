import {describe, expect, it, vi} from 'vitest'
import type {BrowserLogSinkEvent} from '../../browsers-types'
import type {CdpProtocolMessage} from '../../run-chromium/chromium-types'
import type {CDPClient} from '../../run-chromium/cdp/cdp-client'
import {registerAutoEnableLogging} from '../../run-chromium/cdp/cdp-extension-controller/logging'

// E21: browser-generated Log.entryAdded entries must reach the host log sink
// (they never pass through the extension's console hook), while console-API
// events must NOT be routed (the SW producer already ingests those).

function createFakeCdp() {
  let handler: ((message: CdpProtocolMessage) => void) | undefined
  const cdp = {
    onProtocolEvent: (cb: (message: CdpProtocolMessage) => void) => {
      handler = cb
    },
    sendCommand: vi.fn().mockResolvedValue({})
  } as unknown as CDPClient
  return {cdp, emit: (message: CdpProtocolMessage) => handler?.(message)}
}

describe('registerAutoEnableLogging log sink (E21)', () => {
  it('routes Log.entryAdded to the sink with normalized levels', () => {
    const {cdp, emit} = createFakeCdp()
    const events: BrowserLogSinkEvent[] = []
    registerAutoEnableLogging(
      cdp,
      () => null,
      (event) => events.push(event)
    )

    emit({
      method: 'Log.entryAdded',
      params: {
        entry: {
          source: 'other',
          level: 'warning',
          text: 'Alarm delay is less than minimum of 1 minutes. In released .crx, alarm "poll" will fire in approximately 1 minutes.',
          url: 'chrome-extension://abc/background.js',
          lineNumber: 12,
          timestamp: 1789000000000
        }
      }
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      level: 'warn',
      text: expect.stringContaining('Alarm delay is less than minimum'),
      source: 'other',
      url: 'chrome-extension://abc/background.js',
      lineNumber: 12,
      timestamp: 1789000000000
    })
  })

  it('maps verbose→debug and error→error', () => {
    const {cdp, emit} = createFakeCdp()
    const events: BrowserLogSinkEvent[] = []
    registerAutoEnableLogging(
      cdp,
      () => null,
      (event) => events.push(event)
    )

    emit({
      method: 'Log.entryAdded',
      params: {entry: {level: 'verbose', text: 'noise'}}
    })
    emit({
      method: 'Log.entryAdded',
      params: {entry: {level: 'error', text: 'CSP refused to load script'}}
    })

    expect(events.map((e) => e.level)).toEqual(['debug', 'error'])
  })

  it('does NOT route Runtime.consoleAPICalled (producer owns those)', () => {
    const {cdp, emit} = createFakeCdp()
    const events: BrowserLogSinkEvent[] = []
    registerAutoEnableLogging(
      cdp,
      () => null,
      (event) => events.push(event)
    )

    emit({
      method: 'Runtime.consoleAPICalled',
      params: {type: 'warn', args: [{value: 'from console'}]}
    })

    expect(events).toHaveLength(0)
  })

  it('is a no-op without a sink and never throws on malformed entries', () => {
    const {cdp, emit} = createFakeCdp()
    registerAutoEnableLogging(cdp, () => null)

    expect(() => {
      emit({method: 'Log.entryAdded', params: {}})
      emit({method: 'Log.entryAdded'})
    }).not.toThrow()
  })
})
