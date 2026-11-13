import {describe, expect, it} from 'vitest'
import {BridgeBroker, type BridgeConnection} from '../broker'
import type {ServerFrame} from '../contracts'

class FakeConn implements BridgeConnection {
  sent: ServerFrame[] = []
  closed: string[] = []
  constructor(readonly id: string) {}
  send(frame: ServerFrame) {
    this.sent.push(frame)

    return true
  }
  close(_code?: number, reason?: string) {
    this.closed.push(String(reason))
  }
}

const reloads = (conn: FakeConn) =>
  conn.sent.filter((frame) => frame.type === 'reload')

function broker() {
  return new BridgeBroker({instanceId: 'inst-1', runId: 'run-A'} as never)
}

function hello(b: BridgeBroker, conn: FakeConn, build?: string) {
  b.onFrame(conn, {
    type: 'hello',
    v: 1,
    role: 'producer',
    instanceId: 'inst-1',
    ...(build === undefined ? {} : {build})
  } as never)
}

// The background reads the instance id from disk as it starts, so a copy a
// kept profile cached in an earlier session passes that check with old code.
describe('a background whose build this session never compiled', () => {
  it('is told to reload once, and is not taken as the session background', () => {
    const b = broker()
    const cached = new FakeConn('cached')

    b.noteSessionBuild('build-now')
    hello(b, cached, 'build-before')

    expect(reloads(cached)).toEqual([
      {
        type: 'reload',
        reloadType: 'full',
        label: 'extension (resyncing previous dev session)'
      }
    ])

    expect(cached.closed).toHaveLength(1)
    expect(b.runsBuild('build-before')).toBe(false)
  })

  // The same bytes as the session before: nothing to reload, one start.
  it('is left alone when the kept copy is the build this session compiled', () => {
    const b = broker()
    const cached = new FakeConn('cached')

    b.noteSessionBuild('build-now')
    hello(b, cached, 'build-now')

    expect(reloads(cached)).toEqual([])
    expect(cached.closed).toEqual([])
    expect(b.runsBuild('build-now')).toBe(true)
  })

  // A worker the browser woke after an edit that did not restart it still
  // names the build it started on, and that build is this session's own.
  it('is left alone when it runs an older build of this same session', () => {
    const b = broker()
    const worker = new FakeConn('worker')

    b.noteSessionBuild('build-1')
    b.noteSessionBuild('build-2')
    hello(b, worker, 'build-1')

    expect(reloads(worker)).toEqual([])
    expect(worker.closed).toEqual([])
  })

  it('is taken as it is while the session has compiled nothing yet', () => {
    const b = broker()
    const early = new FakeConn('early')

    hello(b, early, 'build-before')

    expect(reloads(early)).toEqual([])
    expect(early.closed).toEqual([])
  })

  // Under --no-browser a running browser reconnects before the first compile.
  it('is told to reload when the first compile shows it was an earlier build', () => {
    const b = broker()
    const early = new FakeConn('early')
    const current = new FakeConn('current')

    hello(b, early, 'build-before')
    hello(b, current, 'build-now')
    b.noteSessionBuild('build-now')

    expect(reloads(early)).toHaveLength(1)
    expect(early.closed).toHaveLength(1)
    expect(reloads(current)).toEqual([])

    b.noteSessionBuild('build-next')

    expect(reloads(current)).toEqual([])
  })

  it('takes a background that names no build', () => {
    const b = broker()
    const unnamed = new FakeConn('unnamed')

    b.noteSessionBuild('build-now')
    hello(b, unnamed)

    expect(reloads(unnamed)).toEqual([])
    expect(unnamed.closed).toEqual([])
  })

  it('stops resyncing a background that keeps coming back stale', () => {
    const b = broker()

    b.noteSessionBuild('build-now')

    const sent = [1, 2, 3, 4].map((n) => {
      const conn = new FakeConn(`cached-${n}`)

      hello(b, conn, 'build-before')

      return reloads(conn).length
    })

    expect(sent).toEqual([1, 1, 1, 0])
  })
})
