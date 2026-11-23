import {type ChildProcess, spawn} from 'node:child_process'
import {once} from 'node:events'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {isPidAlive} from '../browsers/browsers-lib/resolve-live-pid'
import {defined} from './helpers/defined'
import {killCliTree} from './helpers/run-cli'

// Above every platform's pid ceiling, so a kill that slips through names no
// process on this machine.
const PID = 2 ** 30

const running = {pid: PID, exitCode: null, signalCode: null}
const exited = {pid: PID, exitCode: 0, signalCode: null}
const signaled = {pid: PID, exitCode: null, signalCode: 'SIGKILL' as const}

describe('the spec helper stop on Windows', () => {
  it('ends the whole tree through the product tree kill while the CLI runs', () => {
    const killTree = vi.fn()

    killCliTree(running, {platform: 'win32', killTree})

    expect(killTree.mock.calls).toEqual([[PID]])
  })

  // Windows frees the pid at the exit, and a later process may hold it.
  it.each([
    ['exited', exited],
    ['died of a signal', signaled]
  ])('sends nothing once the CLI %s', (_name, child) => {
    const killTree = vi.fn()

    killCliTree(child, {platform: 'win32', killTree})

    expect(killTree).not.toHaveBeenCalled()
  })

  it('sends nothing for a CLI that never got a pid', () => {
    const killTree = vi.fn()

    killCliTree(
      {pid: undefined, exitCode: null, signalCode: null},
      {platform: 'win32', killTree}
    )

    expect(killTree).not.toHaveBeenCalled()
  })
})

describe('the spec helper stop elsewhere', () => {
  // The group outlives its leader while a grandchild is in it, and its id is
  // not handed out again until the last member is gone.
  it('ends the group the CLI led even after the CLI exited', () => {
    const killTree = vi.fn()

    killCliTree(exited, {platform: 'linux', killTree})

    expect(killTree.mock.calls).toEqual([[PID]])
  })
})

// Both stand-ins are Node processes, so every host runs this: the process
// group ends them off Windows and the system taskkill ends them on it.
describe('the spec helper stop on a real process tree', () => {
  const started: ChildProcess[] = []
  const grandchildren: number[] = []

  // A failed run leaves nothing behind, and a pid is signaled only seconds
  // after this spec read it.
  afterEach(() => {
    for (const child of started.splice(0)) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
      }
    }

    for (const pid of grandchildren.splice(0)) {
      if (isPidAlive(pid)) process.kill(pid, 'SIGKILL')
    }
  })

  it('takes the grandchild down with the child it started', async () => {
    // Spawned as the helper spawns the CLI: a group leader off Windows.
    const child = spawn(
      process.execPath,
      [
        '-e',
        "const c = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'}); console.log(c.pid); setInterval(() => {}, 1000)"
      ],
      {
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      }
    )
    started.push(child)

    const [chunk] = (await once(
      defined(child.stdout, 'the stdout pipe of the child'),
      'data'
    )) as [Buffer]
    const grandchild = Number(String(chunk).trim())
    grandchildren.push(grandchild)

    expect(isPidAlive(grandchild)).toBe(true)

    const exit = once(child, 'exit')
    killCliTree(child)
    await exit

    await vi.waitFor(() => expect(isPidAlive(grandchild)).toBe(false), {
      timeout: 5000
    })
  })
})
