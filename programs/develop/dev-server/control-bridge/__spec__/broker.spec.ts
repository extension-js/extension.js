import {describe, it, expect} from 'vitest'
import {
  BridgeBroker,
  CLOSE_BAD_INSTANCE,
  CLOSE_CONTROL_UNAVAILABLE,
  type BridgeConnection
} from '../broker'
import {LogRingBuffer} from '../ring-buffer'
import type {IncomingLogEvent, ServerFrame} from '../contracts'

class FakeConn implements BridgeConnection {
  sent: ServerFrame[] = []
  closed: {code?: number; reason?: string} | null = null
  constructor(readonly id: string) {}
  send(frame: ServerFrame) {
    this.sent.push(frame)
  }
  close(code?: number, reason?: string) {
    this.closed = {code, reason}
  }
}

function incoming(message: string): IncomingLogEvent {
  return {
    v: 1,
    id: Math.random().toString(36).slice(2),
    timestamp: 0,
    level: 'info',
    context: 'background',
    messageParts: [message],
    runId: 'run-A'
  }
}

const opts = {instanceId: 'inst-1', runId: 'run-A', engine: 'chromium' as const}

describe('BridgeBroker (Slice 1: logs)', () => {
  it('rejects a hello with the wrong instanceId', () => {
    const b = new BridgeBroker(opts)
    const c = new FakeConn('c')
    b.onFrame(c, {type: 'hello', v: 1, role: 'consumer', instanceId: 'WRONG'})
    expect(c.closed?.code).toBe(CLOSE_BAD_INSTANCE)
    expect(b.consumerCount).toBe(0)
  })

  it('refuses the controller role when control is not enabled', () => {
    const b = new BridgeBroker(opts) // no allowControl
    const c = new FakeConn('c')
    b.onFrame(c, {
      type: 'hello',
      v: 1,
      role: 'controller',
      instanceId: 'inst-1'
    })
    expect(c.closed?.code).toBe(CLOSE_CONTROL_UNAVAILABLE)
  })

  it('sends a ready frame to a consumer on hello', () => {
    const b = new BridgeBroker(opts)
    const c = new FakeConn('c')
    b.onFrame(c, {type: 'hello', v: 1, role: 'consumer', instanceId: 'inst-1'})
    expect(b.consumerCount).toBe(1)
    expect(c.sent[0]).toMatchObject({
      type: 'ready',
      runId: 'run-A',
      engine: 'chromium'
    })
  })

  it('fans a producer log out to consumers with a stamped seq', () => {
    const b = new BridgeBroker(opts)
    const prod = new FakeConn('p')
    const cons = new FakeConn('c')
    b.onFrame(prod, {
      type: 'hello',
      v: 1,
      role: 'producer',
      instanceId: 'inst-1'
    })
    b.onFrame(cons, {
      type: 'hello',
      v: 1,
      role: 'consumer',
      instanceId: 'inst-1'
    })
    cons.sent = [] // drop the ready frame
    b.onFrame(prod, {type: 'log', event: {...incoming('hi'), seq: 0} as any})
    expect(cons.sent).toHaveLength(1)
    expect(cons.sent[0]).toMatchObject({type: 'log'})
    expect((cons.sent[0] as any).event.seq).toBe(1)
  })

  it('replays the retained ring to a late consumer', () => {
    const ring = new LogRingBuffer()
    const b = new BridgeBroker({...opts, ring})
    const prod = new FakeConn('p')
    b.onFrame(prod, {
      type: 'hello',
      v: 1,
      role: 'producer',
      instanceId: 'inst-1'
    })
    b.ingestLog(incoming('a'))
    b.ingestLog(incoming('b'))
    const late = new FakeConn('late')
    b.onFrame(late, {
      type: 'hello',
      v: 1,
      role: 'consumer',
      instanceId: 'inst-1'
    })
    // ready + 2 replayed logs
    expect(late.sent[0]).toMatchObject({type: 'ready', bufferedFrom: 1})
    expect(late.sent.slice(1).map((f: any) => f.event.messageParts[0])).toEqual(
      ['a', 'b']
    )
  })

  it('emits a gap frame when the ring overflows', () => {
    const ring = new LogRingBuffer(2)
    const b = new BridgeBroker({...opts, ring})
    const cons = new FakeConn('c')
    b.onFrame(cons, {
      type: 'hello',
      v: 1,
      role: 'consumer',
      instanceId: 'inst-1'
    })
    cons.sent = []
    b.ingestLog(incoming('a'))
    b.ingestLog(incoming('b'))
    b.ingestLog(incoming('c')) // overflow -> drop 1
    const gaps = cons.sent.filter((f) => f.type === 'gap')
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({
      type: 'gap',
      dropped: 1,
      reason: 'ring_overflow'
    })
  })

  it('ignores log frames from non-producer connections', () => {
    const b = new BridgeBroker(opts)
    const cons = new FakeConn('c')
    b.onFrame(cons, {
      type: 'hello',
      v: 1,
      role: 'consumer',
      instanceId: 'inst-1'
    })
    cons.sent = []
    // a consumer (or unauthed conn) sending a log must be ignored
    b.onFrame(cons, {type: 'log', event: {...incoming('x'), seq: 0} as any})
    expect(cons.sent).toHaveLength(0)
  })

  it('drops a connection on close', () => {
    const b = new BridgeBroker(opts)
    const c = new FakeConn('c')
    b.onFrame(c, {type: 'hello', v: 1, role: 'consumer', instanceId: 'inst-1'})
    expect(b.consumerCount).toBe(1)
    b.onClose(c)
    expect(b.consumerCount).toBe(0)
  })
})
