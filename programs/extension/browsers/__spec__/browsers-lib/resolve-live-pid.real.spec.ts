import {type ChildProcess, spawn} from 'node:child_process'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  findLiveBrowserPid,
  listProcesses
} from '../../browsers-lib/resolve-live-pid'

// The table is read from this machine, with a Node process that idles
// standing in for the browser: no fake answers for the system's own tool.
describe('listProcesses on this machine', () => {
  const children: ChildProcess[] = []
  const dirs: string[] = []

  afterEach(() => {
    for (const child of children.splice(0)) child.kill('SIGKILL')

    for (const dir of dirs.splice(0)) {
      rmSync(dir, {recursive: true, force: true})
    }
  })

  it('names a live process with its parent and the profile on its command line', () => {
    const profile = mkdtempSync(join(tmpdir(), 'extjs-live-pid-'))
    dirs.push(profile)

    const child = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)', '--', '-profile', profile],
      {stdio: 'ignore', windowsHide: true}
    )
    children.push(child)

    const started = Date.now()
    const rows = listProcesses()
    const elapsedMs = Date.now() - started

    expect(rows.find((row) => row.pid === child.pid)?.ppid).toBe(process.pid)
    expect(
      findLiveBrowserPid({
        profilePath: profile,
        binary: process.execPath,
        launcherPid: child.pid,
        rows
      })
    ).toBe(child.pid)

    // The handoff polls twice a second for five seconds. A Windows read
    // through Get-CimInstance took 23 seconds, the one in use 0.3.
    expect(elapsedMs).toBeLessThan(5000)
  })
})
