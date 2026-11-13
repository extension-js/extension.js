import {type ChildProcess, spawn} from 'node:child_process'
import {afterEach, describe, expect, it} from 'vitest'
import {
  forceKillMarkedOnExit,
  markDescendants
} from '../browsers-lib/process-teardown'

// A parent that starts one helper and prints its pid, the shape of a browser
// and the helper it leaves behind when it is killed outright.
const PARENT = `
const {spawn} = require('node:child_process')
const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'})
console.log(helper.pid)
setInterval(() => {}, 1000)
`

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

const until = async (check: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms

  while (!check() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  return check()
}

describe.skipIf(process.platform === 'win32')('the helper sweep', () => {
  const started: ChildProcess[] = []
  const helpers: number[] = []

  async function startTree() {
    const parent = spawn(process.execPath, ['-e', PARENT], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    started.push(parent)

    const helperPid = await new Promise<number>((resolve, reject) => {
      parent.stdout?.once('data', (chunk) => resolve(Number(String(chunk))))
      parent.once('error', reject)
    })
    helpers.push(helperPid)

    return {parent, helperPid}
  }

  afterEach(() => {
    for (const child of started.splice(0)) child.kill('SIGKILL')

    for (const pid of helpers.splice(0)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Already gone
      }
    }
  })

  it('kills the helper a killed browser leaves behind', async () => {
    const {parent, helperPid} = await startTree()
    const marks = markDescendants(parent.pid)

    expect(marks.map((mark) => mark.pid)).toEqual([helperPid])
    expect(marks[0].started).not.toBe('')

    parent.kill('SIGKILL')
    await until(() => parent.exitCode !== null || parent.signalCode !== null)

    // Orphaned and still running, which is what the sweep is for.
    expect(isAlive(helperPid)).toBe(true)
    expect(forceKillMarkedOnExit(marks)).toEqual([helperPid])
    expect(await until(() => !isAlive(helperPid))).toBe(true)
  })

  it('never signals a pid whose start time is not the one it noted', async () => {
    const {parent, helperPid} = await startTree()
    const marks = markDescendants(parent.pid).map((mark) => ({
      ...mark,
      started: 'Thu Jan  1 00:00:00 1970'
    }))

    expect(forceKillMarkedOnExit(marks)).toEqual([])
    expect(isAlive(helperPid)).toBe(true)
  })

  it('walks only a tree this process spawned', async () => {
    const {parent} = await startTree()

    // Our own parent has children, this process among them, and none is ours.
    expect(markDescendants(process.ppid)).toEqual([])
    expect(markDescendants(parent.pid, process.ppid)).toEqual([])
    expect(markDescendants(undefined)).toEqual([])
    expect(forceKillMarkedOnExit([])).toEqual([])
  })
})
