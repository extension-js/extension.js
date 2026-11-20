import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {quietBroker} from '../../__spec__/helpers/quiet-broker'
import {idleCompiler} from '../../__spec__/helpers/real-compiler'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import type {ReloadAckOutcome} from '../../dev-server/control-bridge/contracts'
import {createReloadSession, RELOAD_DELIVERY_HOLD_MS} from '../reload-session'

const tempFolder = trackTempFolders()

beforeEach(() => {
  expect.hasAssertions()
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// The session on a real compiler that never runs, so watchRun is the
// bundler's own hook and a test fires it the way a rebuild would.
function session(ack: () => Promise<ReloadAckOutcome>) {
  const compiler = idleCompiler(tempFolder('extjs-hold-bound-'), 'development')
  const reloads = createReloadSession({browser: 'chrome'})

  reloads.connect(quietBroker({broadcastReload: () => 1, awaitReloadAck: ack}))
  reloads.watch(compiler)

  let started = false
  const nextBuild = () =>
    compiler.hooks.watchRun.promise(compiler).then(() => {
      started = true
    })

  return {reloads, nextBuild, hasStarted: () => started}
}

describe('how long a delivery holds the next build', () => {
  it('holds it until the browser answered', async () => {
    let answer: ((outcome: ReloadAckOutcome) => void) | undefined
    const dev = session(
      () =>
        new Promise<ReloadAckOutcome>((resolve) => {
          answer = resolve
        })
    )

    void dev.reloads.deliver({type: 'full'})
    await vi.advanceTimersByTimeAsync(0)
    void dev.nextBuild()
    await vi.advanceTimersByTimeAsync(1000)
    expect(dev.hasStarted()).toBe(false)

    answer?.('acked')
    await vi.advanceTimersByTimeAsync(0)
    expect(dev.hasStarted()).toBe(true)
  })

  it('lets it run at the bound when the broker never answers', async () => {
    const dev = session(() => new Promise<ReloadAckOutcome>(() => {}))

    void dev.reloads.deliver({type: 'full'})
    await vi.advanceTimersByTimeAsync(0)
    void dev.nextBuild()

    await vi.advanceTimersByTimeAsync(RELOAD_DELIVERY_HOLD_MS - 1)
    expect(dev.hasStarted()).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(dev.hasStarted()).toBe(true)
  })

  it('holds nothing once that delivery is past its bound', async () => {
    const dev = session(() => new Promise<ReloadAckOutcome>(() => {}))

    void dev.reloads.deliver({type: 'full'})
    await vi.advanceTimersByTimeAsync(RELOAD_DELIVERY_HOLD_MS)

    void dev.nextBuild()
    await vi.advanceTimersByTimeAsync(0)
    expect(dev.hasStarted()).toBe(true)
  })

  it('holds nothing when no delivery is out or it sent nothing', async () => {
    const dev = session(() => Promise.resolve('acked'))

    void dev.nextBuild()
    await vi.advanceTimersByTimeAsync(0)
    expect(dev.hasStarted()).toBe(true)

    const idle = session(() => new Promise<ReloadAckOutcome>(() => {}))

    void idle.reloads.deliver(undefined)
    await vi.advanceTimersByTimeAsync(0)
    void idle.nextBuild()
    await vi.advanceTimersByTimeAsync(0)
    expect(idle.hasStarted()).toBe(true)
  })
})
