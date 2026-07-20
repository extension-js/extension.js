import {describe, expect, it} from 'vitest'
import {
  BridgeBroker,
  type BridgeConnection,
  CLOSE_BAD_INSTANCE,
  CLOSE_CONTROL_UNAVAILABLE
} from '../broker'
import type {IncomingLogEvent, ServerFrame} from '../contracts'
import {LogRingBuffer} from '../ring-buffer'

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
    const b = new BridgeBroker(opts)
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
    cons.sent = []
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
    b.ingestLog(incoming('c'))
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

describe('BridgeBroker.broadcastReload (controller-less dev loop)', () => {
  function hello(
    b: BridgeBroker,
    conn: FakeConn,
    role: 'producer' | 'consumer'
  ) {
    b.onFrame(conn, {type: 'hello', v: 1, role, instanceId: 'inst-1'})
  }

  it('pushes a typed reload frame to every producer and returns the count', () => {
    const b = new BridgeBroker(opts)
    const p1 = new FakeConn('p1')
    const p2 = new FakeConn('p2')
    hello(b, p1, 'producer')
    hello(b, p2, 'producer')

    const notified = b.broadcastReload({
      type: 'content-scripts',
      changedContentScriptEntries: ['content_scripts/content-0']
    })

    expect(notified).toBe(2)
    for (const p of [p1, p2]) {
      expect(p.sent).toHaveLength(1)
      expect(p.sent[0]).toMatchObject({
        type: 'reload',
        reloadType: 'content-scripts',
        changedContentScriptEntries: ['content_scripts/content-0']
      })
    }
  })

  it('never delivers a reload to consumers (it is a producer-only signal)', () => {
    const b = new BridgeBroker(opts)
    const prod = new FakeConn('p')
    const cons = new FakeConn('c')
    hello(b, prod, 'producer')
    hello(b, cons, 'consumer')
    cons.sent = []

    const notified = b.broadcastReload({type: 'full'})

    expect(notified).toBe(1)
    expect(cons.sent).toHaveLength(0)
    expect(prod.sent[0]).toMatchObject({type: 'reload', reloadType: 'full'})
  })

  it('is not gated on allowControl, the dev loop reloads without --allow-control', () => {
    const b = new BridgeBroker(opts)
    const prod = new FakeConn('p')
    hello(b, prod, 'producer')
    expect(b.broadcastReload({type: 'service-worker'})).toBe(1)
  })

  it('returns 0 when no producer has connected yet', () => {
    const b = new BridgeBroker(opts)
    expect(b.broadcastReload({type: 'full'})).toBe(0)
  })

  it('self-heals a STALE producer: full-reload frame before the close', () => {
    const b = new BridgeBroker(opts)
    const stale = new FakeConn('stale')
    b.onFrame(stale, {
      type: 'hello',
      v: 1,
      role: 'producer',
      instanceId: 'PREVIOUS-SESSION'
    })

    expect(stale.sent).toHaveLength(1)
    expect(stale.sent[0]).toMatchObject({
      type: 'reload',
      reloadType: 'full',
      label: 'extension (resyncing previous dev session)'
    })
    expect(stale.closed?.code).toBe(CLOSE_BAD_INSTANCE)
    expect(b.producerCount).toBe(0)
  })

  it('does NOT resync stale controllers or consumers (they are not the extension)', () => {
    const b = new BridgeBroker({...opts, allowControl: true})
    for (const role of ['controller', 'consumer'] as const) {
      const c = new FakeConn(role)
      b.onFrame(c, {type: 'hello', v: 1, role, instanceId: 'PREVIOUS-SESSION'})
      expect(c.sent).toHaveLength(0)
      expect(c.closed?.code).toBe(CLOSE_BAD_INSTANCE)
    }
  })

  it('storm-guards the resync: at most 3 reloads per rolling minute', () => {
    let nowMs = 1_000_000
    const b = new BridgeBroker({...opts, now: () => nowMs})

    const helloStale = () => {
      const c = new FakeConn('s')
      b.onFrame(c, {
        type: 'hello',
        v: 1,
        role: 'producer',
        instanceId: 'PREVIOUS-SESSION'
      })
      return c
    }

    for (let i = 0; i < 3; i++) {
      expect(helloStale().sent).toHaveLength(1)
    }
    const fourth = helloStale()
    expect(fourth.sent).toHaveLength(0)
    expect(fourth.closed?.code).toBe(CLOSE_BAD_INSTANCE)

    nowMs += 61_000
    expect(helloStale().sent).toHaveLength(1)
  })

  it('forwards the shared announcement label + changed files on the frame', () => {
    const b = new BridgeBroker(opts)
    const prod = new FakeConn('p')
    hello(b, prod, 'producer')

    b.broadcastReload({
      type: 'page',
      label: 'sidebar page (src/sidebar/index.tsx)',
      changedFiles: ['src/sidebar/index.tsx']
    })

    expect(prod.sent[0]).toMatchObject({
      type: 'reload',
      reloadType: 'page',
      label: 'sidebar page (src/sidebar/index.tsx)',
      changedFiles: ['src/sidebar/index.tsx']
    })
  })

  it('latches an undeliverable reload and hands it to the next producer hello', () => {
    const b = new BridgeBroker(opts)
    expect(b.broadcastReload({type: 'full', label: 'extension'})).toBe(0)

    const prod = new FakeConn('p')
    hello(b, prod, 'producer')
    expect(prod.sent).toHaveLength(1)
    expect(prod.sent[0]).toMatchObject({
      type: 'reload',
      reloadType: 'full',
      label: 'extension'
    })

    const prod2 = new FakeConn('p2')
    hello(b, prod2, 'producer')
    expect(prod2.sent).toHaveLength(0)
  })

  it('keeps only the newest undeliverable reload and clears it on a delivered broadcast', () => {
    const b = new BridgeBroker(opts)
    b.broadcastReload({type: 'service-worker'})
    b.broadcastReload({type: 'full'})

    const prod = new FakeConn('p')
    hello(b, prod, 'producer')
    expect(prod.sent).toHaveLength(1)
    expect(prod.sent[0]).toMatchObject({type: 'reload', reloadType: 'full'})

    b.broadcastReload({type: 'service-worker'})
    const late = new FakeConn('late')
    hello(b, late, 'producer')
    expect(late.sent).toHaveLength(0)
  })

  it('latches a DELIVERED content-scripts reload until the producer acks (bug 27)', () => {
    const b = new BridgeBroker(opts)
    const wedged = new FakeConn('wedged')
    hello(b, wedged, 'producer')

    expect(
      b.broadcastReload({
        type: 'content-scripts',
        label: 'content_script (content/index.ts)'
      })
    ).toBe(1)

    const fresh = new FakeConn('fresh')
    hello(b, fresh, 'producer')
    expect(fresh.sent).toHaveLength(1)
    expect(fresh.sent[0]).toMatchObject({
      type: 'reload',
      reloadType: 'content-scripts',
      label: 'content_script (content/index.ts)'
    })

    const later = new FakeConn('later')
    hello(b, later, 'producer')
    expect(later.sent).toHaveLength(0)
  })

  it('reload-ack releases the content-scripts latch (no replay on next hello)', () => {
    const b = new BridgeBroker(opts)
    const prod = new FakeConn('p')
    hello(b, prod, 'producer')

    b.broadcastReload({type: 'content-scripts', label: 'content_script'})
    b.onFrame(prod, {
      type: 'reload-ack',
      reloadType: 'content-scripts',
      label: 'content_script'
    })

    const fresh = new FakeConn('fresh')
    hello(b, fresh, 'producer')
    expect(fresh.sent).toHaveLength(0)
  })

  it('ignores a reload-ack from a non-producer connection', () => {
    const b = new BridgeBroker(opts)
    const prod = new FakeConn('p')
    const cons = new FakeConn('c')
    hello(b, prod, 'producer')
    hello(b, cons, 'consumer')

    b.broadcastReload({type: 'content-scripts'})
    b.onFrame(cons, {type: 'reload-ack', reloadType: 'content-scripts'})

    const fresh = new FakeConn('fresh')
    hello(b, fresh, 'producer')
    expect(fresh.sent).toHaveLength(1)
  })

  it('delivered full reloads still clear the latch (replaying one would loop the restart)', () => {
    const b = new BridgeBroker(opts)
    const prod = new FakeConn('p')
    hello(b, prod, 'producer')

    expect(b.broadcastReload({type: 'full', label: 'extension'})).toBe(1)

    const fresh = new FakeConn('fresh')
    hello(b, fresh, 'producer')
    expect(fresh.sent).toHaveLength(0)
  })

  it('pings connected producers only (SW keepalive)', () => {
    const b = new BridgeBroker(opts)
    const prod = new FakeConn('p')
    const cons = new FakeConn('c')
    hello(b, prod, 'producer')
    hello(b, cons, 'consumer')
    cons.sent = []

    expect(b.pingProducers()).toBe(1)
    expect(prod.sent).toEqual([{type: 'ping'}])
    expect(cons.sent).toHaveLength(0)
  })
})

describe('BridgeBroker.undeliveredReloadWarning (§53: SW-not-attached DX)', () => {
  const GRACE_MS = 10_000

  function brokerAt(startMs: number) {
    let nowMs = startMs
    const b = new BridgeBroker({...opts, now: () => nowMs})
    return {b, advance: (ms: number) => (nowMs += ms)}
  }

  function helloProducer(b: BridgeBroker, id = 'p') {
    b.onFrame(new FakeConn(id), {
      type: 'hello',
      v: 1,
      role: 'producer',
      instanceId: 'inst-1'
    })
  }

  it('stays silent inside the startup grace window (browser still launching)', () => {
    const {b, advance} = brokerAt(1_000_000)
    advance(GRACE_MS - 1)
    expect(b.undeliveredReloadWarning()).toBeNull()
  })

  it('warns "never-connected" past grace when no SW ever attached (heavy site / auth wall)', () => {
    const {b, advance} = brokerAt(1_000_000)
    advance(GRACE_MS)
    const msg = b.undeliveredReloadWarning()
    expect(msg).toContain('SW not attached')
    expect(msg).toContain('has not connected to the dev server this session')
  })

  it('dedupes: a rapid edit loop warns once per attach-state, not once per save', () => {
    const {b, advance} = brokerAt(1_000_000)
    advance(GRACE_MS)
    expect(b.undeliveredReloadWarning()).not.toBeNull()
    expect(b.undeliveredReloadWarning()).toBeNull()
    expect(b.undeliveredReloadWarning()).toBeNull()
  })

  it('warns "recently-disconnected" after an attach→detach, and only once', () => {
    const {b, advance} = brokerAt(1_000_000)
    advance(GRACE_MS)

    expect(b.undeliveredReloadWarning()).toContain(
      'has not connected to the dev server this session'
    )

    const prod = new FakeConn('p')
    b.onFrame(prod, {
      type: 'hello',
      v: 1,
      role: 'producer',
      instanceId: 'inst-1'
    })
    b.onClose(prod)

    const msg = b.undeliveredReloadWarning()
    expect(msg).toContain('SW not attached')
    expect(msg).toContain('disconnected')
    expect(b.undeliveredReloadWarning()).toBeNull()
  })

  it('stays silent while a stale-instance resync is in flight (a reload is already coming)', () => {
    const {b, advance} = brokerAt(1_000_000)
    advance(GRACE_MS)

    b.onFrame(new FakeConn('stale'), {
      type: 'hello',
      v: 1,
      role: 'producer',
      instanceId: 'PREVIOUS-SESSION'
    })

    expect(b.undeliveredReloadWarning()).toBeNull()
  })
})
