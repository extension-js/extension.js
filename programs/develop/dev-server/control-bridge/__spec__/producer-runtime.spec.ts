import {describe, it, expect} from 'vitest'
import {
  buildBridgeProducerSource,
  BRIDGE_PRODUCER_SOURCE
} from '../producer-runtime'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  url: string
  sent: string[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.onclose && this.onclose()
  }
  triggerOpen() {
    this.onopen && this.onopen()
  }
}

function makeGlobal() {
  const calls: Array<{level: string; args: unknown[]}> = []
  const console: Record<string, (...a: unknown[]) => void> = {}
  for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    console[level] = (...args: unknown[]) => calls.push({level, args})
  }
  return {
    fakeGlobal: {WebSocket: FakeWebSocket, console} as Record<string, unknown>,
    originalCalls: calls
  }
}

function run(src: string, fakeGlobal: Record<string, unknown>) {
  // The IIFE reads `globalThis` first; pass our fake as that parameter.
  // eslint-disable-next-line no-new-func
  new Function('globalThis', src)(fakeGlobal)
}

describe('bridge producer runtime', () => {
  it('returns empty source when the control bridge is unavailable', () => {
    expect(buildBridgeProducerSource({controlPort: null, instanceId: 'x'})).toBe('')
    expect(buildBridgeProducerSource({controlPort: 0, instanceId: 'x'})).toBe('')
  })

  it('bakes port, instanceId, and context with no placeholders left', () => {
    const src = buildBridgeProducerSource({
      controlPort: 8147,
      instanceId: 'inst-T',
      context: 'background'
    })
    expect(src).toContain('8147')
    expect(src).toContain('inst-T')
    expect(src).not.toContain('__EXTJS_CONTROL_PORT__')
    expect(src).not.toContain('__EXTJS_INSTANCE_ID__')
    expect(src).not.toContain('__EXTJS_CONTEXT__')
  })

  it('sends a producer hello on open and forwards console as log frames', () => {
    FakeWebSocket.instances = []
    const {fakeGlobal, originalCalls} = makeGlobal()
    const src = buildBridgeProducerSource({
      controlPort: 9999,
      instanceId: 'inst-T',
      context: 'background'
    })
    run(src, fakeGlobal)

    // A console call before the socket opens is queued.
    ;(fakeGlobal.console as any).error('boom', {a: 1})

    const ws = FakeWebSocket.instances[0]
    expect(ws.url).toBe('ws://127.0.0.1:9999/extjs-control')
    ws.triggerOpen()

    const frames = ws.sent.map((s) => JSON.parse(s))
    expect(frames[0]).toMatchObject({type: 'hello', v: 1, role: 'producer', instanceId: 'inst-T'})
    const log = frames.find((f) => f.type === 'log')
    expect(log.event).toMatchObject({
      v: 1,
      level: 'error',
      context: 'background',
      runId: 'inst-T'
    })
    expect(log.event.messageParts).toEqual(['boom', '{"a":1}'])
    expect(typeof log.event.id).toBe('string')

    // Original console must still fire (passthrough).
    expect(originalCalls).toContainEqual({level: 'error', args: ['boom', {a: 1}]})
  })

  it('installs only once per global', () => {
    FakeWebSocket.instances = []
    const {fakeGlobal} = makeGlobal()
    const src = buildBridgeProducerSource({controlPort: 9999, instanceId: 'i'})
    run(src, fakeGlobal)
    run(src, fakeGlobal)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('does nothing when WebSocket is unavailable', () => {
    FakeWebSocket.instances = []
    const fakeGlobal: Record<string, unknown> = {console: {log() {}}}
    const src = buildBridgeProducerSource({controlPort: 9999, instanceId: 'i'})
    expect(() => run(src, fakeGlobal)).not.toThrow()
    expect(FakeWebSocket.instances).toHaveLength(0)
  })

  it('source has no unresolved placeholders by construction', () => {
    expect(BRIDGE_PRODUCER_SOURCE).toContain('__EXTJS_CONTROL_PORT__')
  })
})
