import {describe, expect, it} from 'vitest'
import {
  alreadyRunsLatchedBuild,
  BridgeBroker,
  type BridgeConnection
} from '../broker'
import type {HelloFrame, ReloadFrame, ServerFrame} from '../contracts'

class FakeConn implements BridgeConnection {
  sent: ServerFrame[] = []
  constructor(readonly id: string) {}
  send(frame: ServerFrame) {
    this.sent.push(frame)

    return true
  }
  close() {}
}

const reloads = (conn: FakeConn) =>
  conn.sent.filter((frame) => frame.type === 'reload')

function hello(b: BridgeBroker, conn: FakeConn, build?: string) {
  b.onFrame(conn, {
    type: 'hello',
    v: 1,
    role: 'producer',
    instanceId: 'inst-1',
    ...(build === undefined ? {} : {build})
  } as never)
}

// Two saves in a row: the first restarts the worker, and the second compile
// finishes while it is away, so its reload waits for the worker's hello.
function secondSaveWhileRestarting(second: {
  type: 'full' | 'service-worker' | 'content-scripts' | 'page'
  build?: string
  changedContentScriptEntries?: string[]
  changedScriptFiles?: string[]
  refreshedStylesheets?: {file: string; digest: string}[]
  standalonePages?: string[]
}) {
  const b = new BridgeBroker({instanceId: 'inst-1', runId: 'run-A'} as never)
  const first = new FakeConn('worker-1')

  hello(b, first, 'build-1')
  expect(
    b.broadcastReload({
      type: 'service-worker',
      label: 'service_worker (background.js)',
      build: 'build-2'
    })
  ).toBe(1)

  b.onClose(first)

  expect(
    b.broadcastReload({label: 'service_worker (background.js)', ...second})
  ).toBe(0)

  return b
}

describe('a worker reload held while the worker restarts', () => {
  it('is not sent to a worker that comes back running that same build', async () => {
    const b = secondSaveWhileRestarting({
      type: 'service-worker',
      build: 'build-3'
    })
    const back = new FakeConn('worker-2')

    hello(b, back, 'build-3')

    expect(reloads(back)).toEqual([])
    // Nothing is left held for a wake to deliver.
    await expect(b.deliverLatchedReload()).resolves.toBe(false)

    // It is settled, and a later worker is not handed it either.
    const later = new FakeConn('worker-3')
    hello(b, later, 'build-1')
    expect(reloads(later)).toEqual([])
  })

  it('is sent to a worker that comes back on the build before it', () => {
    const b = secondSaveWhileRestarting({
      type: 'service-worker',
      build: 'build-3'
    })
    const back = new FakeConn('worker-2')

    hello(b, back, 'build-2')

    expect(reloads(back)).toHaveLength(1)
    expect(reloads(back)[0]).toMatchObject({
      reloadType: 'service-worker',
      build: 'build-3'
    })
  })

  it('is sent to a worker that names no build, and when the reload names none', () => {
    const unnamedWorker = secondSaveWhileRestarting({
      type: 'service-worker',
      build: 'build-3'
    })
    const old = new FakeConn('worker-2')
    hello(unnamedWorker, old)
    expect(reloads(old)).toHaveLength(1)

    const unnamedReload = secondSaveWhileRestarting({type: 'service-worker'})
    const back = new FakeConn('worker-2')
    hello(unnamedReload, back, '')
    expect(reloads(back)).toHaveLength(1)
  })

  // The restart is the whole effect only of a plain worker reload. Any other
  // kind, or one that carries more, still has work for the tabs to receive.
  it('is still sent when it does more than restart the worker', () => {
    const more: Array<Parameters<typeof secondSaveWhileRestarting>[0]> = [
      {type: 'full', build: 'build-3'},
      {type: 'content-scripts', build: 'build-3'},
      {type: 'page', build: 'build-3'},
      {
        type: 'service-worker',
        build: 'build-3',
        changedContentScriptEntries: ['content_scripts/content-0']
      },
      {
        type: 'service-worker',
        build: 'build-3',
        changedScriptFiles: ['scripts/widget.js']
      },
      {
        type: 'service-worker',
        build: 'build-3',
        refreshedStylesheets: [{file: 'content_scripts/a.css', digest: 'd'}]
      },
      {
        type: 'service-worker',
        build: 'build-3',
        standalonePages: ['loose/index.html']
      }
    ]

    for (const second of more) {
      const b = secondSaveWhileRestarting(second)
      const back = new FakeConn('worker-2')

      hello(b, back, 'build-3')

      expect([second, reloads(back).length]).toEqual([second, 1])
    }
  })
})

// The watcher can compile the same bytes twice for two quick saves. The
// worker that restarted for the first compile reads that build and says so.
describe('the build the connected backgrounds run', () => {
  const b = () =>
    new BridgeBroker({instanceId: 'inst-1', runId: 'run-A'} as never)

  it('is the one every connected background named in its hello', () => {
    const broker = b()
    const worker = new FakeConn('worker')

    expect(broker.runsBuild('build-2')).toBe(false)

    hello(broker, worker, 'build-2')

    expect(broker.runsBuild('build-2')).toBe(true)
    expect(broker.runsBuild('build-1')).toBe(false)
    expect(broker.runsBuild('')).toBe(false)
  })

  it('is none while one background runs another build, or names none', () => {
    const broker = b()

    hello(broker, new FakeConn('worker'), 'build-2')
    hello(broker, new FakeConn('other'), 'build-1')
    expect(broker.runsBuild('build-2')).toBe(false)

    const unnamed = b()
    hello(unnamed, new FakeConn('old-worker'))
    expect(unnamed.runsBuild('build-2')).toBe(false)
  })

  it('is forgotten when the background disconnects, and ignores a consumer', () => {
    const broker = b()
    const worker = new FakeConn('worker')

    hello(broker, worker, 'build-2')
    broker.onFrame(new FakeConn('reader'), {
      type: 'hello',
      v: 1,
      role: 'consumer',
      instanceId: 'inst-1'
    } as never)

    expect(broker.runsBuild('build-2')).toBe(true)

    broker.onClose(worker)
    expect(broker.runsBuild('build-2')).toBe(false)
  })

  it('does not hold back a broadcast, which the dispatch decides', () => {
    const broker = b()
    const worker = new FakeConn('worker')

    hello(broker, worker, 'build-2')

    expect(
      broker.broadcastReload({type: 'service-worker', build: 'build-2'})
    ).toBe(1)

    expect(reloads(worker)).toHaveLength(1)
  })
})

describe('alreadyRunsLatchedBuild', () => {
  const frame = (extra: Partial<ReloadFrame> = {}): ReloadFrame => ({
    type: 'reload',
    reloadType: 'service-worker',
    build: 'b',
    ...extra
  })
  const from = (build?: string) => ({build}) as HelloFrame

  it('holds only for a plain worker reload of the build the worker names', () => {
    expect(alreadyRunsLatchedBuild(from('b'), frame())).toBe(true)
    expect(alreadyRunsLatchedBuild(from('a'), frame())).toBe(false)
    expect(alreadyRunsLatchedBuild(from(), frame())).toBe(false)
    expect(alreadyRunsLatchedBuild(from(''), frame({build: ''}))).toBe(false)
    expect(
      alreadyRunsLatchedBuild(from('b'), frame({reloadType: 'full'}))
    ).toBe(false)

    expect(
      alreadyRunsLatchedBuild(
        from('b'),
        frame({changedContentScriptEntries: []})
      )
    ).toBe(true)
  })
})
