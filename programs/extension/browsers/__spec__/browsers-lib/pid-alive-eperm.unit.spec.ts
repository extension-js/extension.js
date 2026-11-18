import {type ChildProcess, spawn} from 'node:child_process'
import {once} from 'node:events'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {isPidAlive} from '../../browsers-lib/resolve-live-pid'
import {
  closeSafariContainerApps,
  rememberRaisedContainerApp
} from '../../run-safari/safari-launch/container-app'
import {onFakeClock} from '../fake-clock'

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'exit'] as const

// The system's answer for a live process owned by another user. The fake
// sends nothing, whatever signal it is asked for.
function refuseEverySignal() {
  return vi.spyOn(process, 'kill').mockImplementation(() => {
    throw Object.assign(new Error('kill EPERM'), {code: 'EPERM'})
  })
}

describe('a pid this user may not signal', () => {
  let bystander: ChildProcess
  let listenersBefore: Map<string, unknown[]>

  beforeEach(async () => {
    listenersBefore = new Map(
      SIGNALS.map((name) => [name, process.listeners(name as 'exit')])
    )

    // Its pid stands in for the foreign one, so nothing else can be reached.
    bystander = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)', 'extjs-spec-bystander'],
      {stdio: 'ignore'}
    )

    await once(bystander, 'spawn')
  })

  afterEach(async () => {
    vi.restoreAllMocks()

    for (const name of SIGNALS) {
      for (const listener of process.listeners(name as 'exit')) {
        if (!listenersBefore.get(name)?.includes(listener)) {
          process.removeListener(name, listener)
        }
      }
    }

    const exited = once(bystander, 'exit')
    process.kill(bystander.pid as number, 'SIGKILL')
    await exited
  })

  it('is alive to the shared probe', () => {
    const kill = refuseEverySignal()

    expect(isPidAlive(bystander.pid)).toBe(true)
    expect(kill.mock.calls).toEqual([[bystander.pid, 0]])
  })

  it('is gone to the shared probe only when the system says no such process', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('kill ESRCH'), {code: 'ESRCH'})
    })

    expect(isPidAlive(bystander.pid)).toBe(false)
    expect(kill.mock.calls).toEqual([[bystander.pid, 0]])
  })

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    null,
    undefined
  ])('is never probed when the pid is %s, which names no process', (pid) => {
    const kill = refuseEverySignal()

    expect(isPidAlive(pid)).toBe(false)
    expect(kill).not.toHaveBeenCalled()
  })

  it('is alive to the Safari container app teardown, which waits its three seconds', async () => {
    const pid = bystander.pid as number
    const tools = {listAppPids: async () => [pid]} as never

    expect(
      await rememberRaisedContainerApp(tools, '/tmp/My.app', new Set())
    ).toEqual([pid])

    const kill = refuseEverySignal()
    const {waitedMs} = await onFakeClock(() => closeSafariContainerApps())

    // A live app is probed every 250 ms until the three seconds are up.
    expect(waitedMs).toBe(3000)
    expect(kill.mock.calls).toEqual([
      [pid, 'SIGTERM'],
      ...Array.from({length: 12}, () => [pid, 0])
    ])

    expect(bystander.exitCode).toBeNull()
    expect(bystander.signalCode).toBeNull()
  })
})
