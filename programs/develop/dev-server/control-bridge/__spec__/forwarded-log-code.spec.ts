import {describe, expect, it} from 'vitest'
import {
  BROWSER_CONSOLE_CODES,
  browserConsoleCodeOf
} from '../../../lib/browser-console-codes'
import {CODES} from '../../../lib/messaging'
import {BridgeBroker, type BridgeConnection} from '../broker'
import type {AnyFrame, LogEvent, ServerFrame} from '../contracts'
import {buildBridgeProducerSource} from '../producer-runtime'

class Socket {
  static opened: Socket[] = []
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: {data: string}) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(readonly url: string) {
    Socket.opened.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {}
}

class Conn implements BridgeConnection {
  sent: ServerFrame[] = []

  constructor(readonly id: string) {}

  send(frame: ServerFrame) {
    this.sent.push(frame)

    return true
  }

  close() {}
}

// The real producer in a background, wired to the real broker: what the
// background prints is what a consumer of the session's logs receives.
function forwarded(print: (console: Console) => void): LogEvent[] {
  Socket.opened = []

  const console = Object.fromEntries(
    ['log', 'info', 'warn', 'error', 'debug', 'trace'].map((level) => [
      level,
      () => {}
    ])
  )
  const source = buildBridgeProducerSource({
    controlPort: 9999,
    instanceId: 'inst-1',
    context: 'background'
  })

  new Function('globalThis', source)({WebSocket: Socket, console})
  print(console as unknown as Console)

  const socket = Socket.opened[0]

  socket.onopen?.()

  const broker = new BridgeBroker({
    instanceId: 'inst-1',
    runId: 'run-A',
    engine: 'chromium'
  })
  const producer = new Conn('producer')
  const consumer = new Conn('consumer')

  broker.onFrame(consumer, {
    type: 'hello',
    v: 1,
    role: 'consumer',
    instanceId: 'inst-1'
  })

  consumer.sent = []

  for (const frame of socket.sent.map((text) => JSON.parse(text) as AnyFrame)) {
    broker.onFrame(producer, frame)
  }

  return consumer.sent.flatMap((frame) =>
    frame.type === 'log' ? [frame.event] : []
  )
}

const RELOAD_LINE =
  'Extension.js W_RELOAD_NOT_APPLIED: the extension could not be reloaded for content_scripts/content-1, so open tabs keep the build they have. Reload it from the extensions page.'

describe('a console line the session forwards', () => {
  it('carries the code the line opens with', () => {
    const events = forwarded((console) => {
      console.warn(RELOAD_LINE, 'Error: gone')
      console.warn(
        'Extension.js W_CONTENT_SCRIPT_MOUNT: the content script default export failed to run.'
      )
    })

    expect(events.map(({code, level}) => [code, level])).toEqual([
      ['W_RELOAD_NOT_APPLIED', 'warn'],
      ['W_CONTENT_SCRIPT_MOUNT', 'warn']
    ])

    expect(events[0].messageParts).toEqual([RELOAD_LINE, 'Error: gone'])
  })

  it('gives no code to a line that only looks like one', () => {
    const events = forwarded((console) => {
      console.warn('Extension.js W_MADE_UP_BY_A_PAGE: something happened')
      console.warn('Extension.js E_COMPILE: a declared code no browser prints')
      console.warn(`a page quoting it: ${RELOAD_LINE}`)
      console.warn('extension.js W_RELOAD_NOT_APPLIED: another spelling')
      console.warn('Extension.js W_RELOAD_NOT_APPLIED with no colon')
      console.warn({text: RELOAD_LINE})
      console.log('[Extension.js] Reloading content_script (a.ts)…')
    })

    expect(events).toHaveLength(7)
    expect(events.filter((event) => 'code' in event)).toEqual([])
  })
})

describe('the codes a browser console prints', () => {
  it('are warning codes the table declares', () => {
    expect(BROWSER_CONSOLE_CODES.size).toBe(5)

    for (const code of BROWSER_CONSOLE_CODES) {
      expect(CODES).toHaveProperty(code)
      expect(code.startsWith('W_')).toBe(true)
      expect(browserConsoleCodeOf([`Extension.js ${code}: text`])).toBe(code)
    }
  })

  it('reads the code from the first part alone', () => {
    expect(browserConsoleCodeOf(['plain', RELOAD_LINE])).toBeUndefined()
    expect(browserConsoleCodeOf([])).toBeUndefined()
    expect(browserConsoleCodeOf(undefined)).toBeUndefined()
  })
})
