import {type ChildProcess, spawn} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {acquireLockNow} from '../lib/install-lock'

// Another process takes and drops the same folder as fast as it can. On
// Windows a folder caught mid-removal answers EPERM where others say EEXIST.
const RIVAL = `
const fs = require('node:fs')
const dir = process.argv[1]
process.stdout.write('up')
for (;;) {
  try {
    fs.mkdirSync(dir)
    fs.rmdirSync(dir)
  } catch {}
}
`

describe('a lock folder another process keeps taking and dropping', () => {
  let scratch: string
  let rival: ChildProcess

  beforeEach(async () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-lock-contention-'))
    rival = spawn(process.execPath, ['-e', RIVAL, path.join(scratch, 'lock')], {
      stdio: ['ignore', 'pipe', 'ignore']
    })

    await new Promise((resolve) => rival.stdout?.once('data', resolve))
  })

  afterEach(async () => {
    const gone = new Promise((resolve) => rival.once('exit', resolve))
    rival.kill('SIGKILL')
    await gone
    fs.rmSync(scratch, {recursive: true, force: true})
  })

  it('answers held or taken on every attempt and never throws', () => {
    const lockDir = path.join(scratch, 'lock')
    const deadline = Date.now() + 1_500
    let taken = 0
    let attempts = 0

    while (Date.now() < deadline) {
      attempts += 1
      const lock = acquireLockNow(lockDir, 60_000)

      if (lock) {
        taken += 1
        lock.release()
      }
    }

    expect(attempts).toBeGreaterThan(100)
    expect(taken).toBeGreaterThan(0)
  })
})

describe('a lock folder Windows reports as refused while it is being removed', () => {
  let scratch: string

  const refusal = () =>
    Object.assign(new Error('EPERM: operation not permitted, mkdir'), {
      code: 'EPERM'
    })

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-lock-eperm-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(scratch, {recursive: true, force: true})
  })

  it('takes the lock once the refusal passes', () => {
    const lockDir = path.join(scratch, 'lock')
    const real = fs.mkdirSync.bind(fs)
    let refusals = 3

    vi.spyOn(fs, 'mkdirSync').mockImplementation(((...args: unknown[]) => {
      if (args[0] === lockDir && refusals-- > 0) throw refusal()

      return (real as (...a: unknown[]) => unknown)(...args)
    }) as typeof fs.mkdirSync)

    const lock = acquireLockNow(lockDir, 60_000)

    expect(lock).not.toBeNull()
    lock?.release()
  })

  it('throws the refusal of a parent that never lets the folder be made', () => {
    const lockDir = path.join(scratch, 'lock')
    const made = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {
      throw refusal()
    })

    expect(() => acquireLockNow(lockDir, 60_000)).toThrow(/EPERM/)
    expect(made).toHaveBeenCalledTimes(20)
  })
})
