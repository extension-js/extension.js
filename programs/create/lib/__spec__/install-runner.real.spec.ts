import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {holdTimeouts, settleOnceReady} from '../../__spec__/clock-after-ready'
import {KILL_GRACE_MS, runInstall} from '../install-runner'

// No child is faked here: the sibling spec drives the runner through its
// spawn seam, so only this file proves what a real child does. Only the
// clock of a timeout row is held until its child runs.
const VERSION = /^\d+\.\d+\.\d+/

// The child names itself in this file once it runs, and the timeout waits.
const readyDirs: string[] = []

function readyFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-install-ready-'))
  readyDirs.push(dir)

  return path.join(dir, 'ready')
}

// The pid goes out with a blocking write first, so it is in the pipe before
// the file says the child is ready. console.log to a pipe is asynchronous.
const markReady = "require('node:fs').writeFileSync(process.argv[1], '1');"

afterEach(() => {
  vi.useRealTimers()

  for (const dir of readyDirs.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

describe('install-runner runInstall (real spawn)', () => {
  it('runs npm --version through its .cmd shim with no shell', async () => {
    // npm ignores the trailing argument. A shell would run "b" after "&"
    // and turn the exit code non-zero, so a zero exit proves no shell ran.
    const result = await runInstall('npm', ['--version', 'a & b'], {
      cwd: process.cwd(),
      stdio: 'pipe'
    })

    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toMatch(VERSION)
    expect(result.stderr).not.toMatch(/not recognized|not found/i)
    // A cold npm on a loaded runner has taken over 5 s to print its version.
  }, 60_000)

  it('rejects with ENOENT for a binary that does not exist', async () => {
    const missing = `extjs-no-such-binary-${process.pid}`

    await expect(
      runInstall(missing, ['install'], {cwd: process.cwd(), stdio: 'pipe'})
    ).rejects.toMatchObject({
      code: 'ENOENT',
      syscall: `spawn ${missing}`,
      path: missing,
      message: expect.stringContaining(`spawn ${missing} ENOENT`)
    })
  })

  it('captures what a failing child wrote to stderr, apart from stdout', async () => {
    const result = await runInstall(
      process.execPath,
      [
        '-e',
        "process.stdout.write('resolving'); process.stderr.write('registry said no'); process.exitCode = 3"
      ],
      {cwd: process.cwd(), stdio: 'pipe'}
    )

    expect(result).toEqual({
      code: 3,
      stdout: 'resolving',
      stderr: 'registry said no'
    })
  })

  it('tee captures what a real failing child wrote while showing it', async () => {
    const shown: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      shown.push(String(chunk))

      return true
    })

    const result = await runInstall(
      process.execPath,
      ['-e', "process.stderr.write('registry said no'); process.exitCode = 3"],
      {cwd: process.cwd(), stdio: 'tee'}
    ).finally(() => vi.restoreAllMocks())

    expect(result).toEqual({code: 3, stdout: '', stderr: 'registry said no'})
    expect(shown.join('')).toBe('registry said no')
  })

  it('ends a child that waits on stdin at once instead of at the timeout', async () => {
    const startedAt = Date.now()

    const result = await runInstall(
      process.execPath,
      [
        '-e',
        "process.stdout.write('Continue? [Y/n] '); process.stdin.resume(); process.stdin.on('end', () => process.exit(4))"
      ],
      {cwd: process.cwd(), stdio: 'pipe', timeoutMs: 10_000}
    )

    expect(result).toEqual({code: 4, stdout: 'Continue? [Y/n] ', stderr: ''})
    expect(Date.now() - startedAt).toBeLessThan(5_000)
  }, 20_000)

  it('kills a child that outlives the timeout', async () => {
    const ready = readyFile()
    holdTimeouts()
    const result = await settleOnceReady(
      runInstall(
        process.execPath,
        [
          '-e',
          `require('node:fs').writeSync(1, process.pid + '\\n'); ${markReady} setInterval(() => {}, 1000)`,
          ready
        ],
        {cwd: process.cwd(), stdio: 'pipe', timeoutMs: 1000}
      ),
      () => fs.existsSync(ready)
    )
    vi.useRealTimers()

    expect(result.code).toBeNull()
    expect(result.reason).toBe(
      'The install did not finish within 1 second (EXTENSION_CREATE_INSTALL_TIMEOUT_MS)'
    )

    // The pid the child printed before it hung is the one that must be gone.
    const pid = Number(result.stdout.trim())
    expect(pid).toBeGreaterThan(0)
    await vi.waitFor(() => expect(isRunning(pid)).toBe(false), {
      timeout: 10_000,
      interval: 50
    })
  }, 20_000)

  describe('a manager that has to be ended', () => {
    // taskkill takes longer to start than a signal takes to arrive.
    const LATE_MS = process.platform === 'win32' ? 4000 : 1500
    const started: number[] = []
    const tmpRoots: string[] = []

    afterEach(() => {
      // Only a pid these rows started and never saw end, so it is still theirs.
      for (const pid of started.splice(0)) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // Already gone, which is the point.
        }
      }

      // Windows frees a folder a moment after the last process in it is gone.
      for (const dir of tmpRoots.splice(0)) {
        fs.rmSync(dir, {recursive: true, force: true, maxRetries: 5})
      }
    })

    // A package manager stand-in, written where only this row reads it.
    function standIn(source: string) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-install-tree-'))
      tmpRoots.push(dir)
      const script = path.join(dir, 'manager.cjs')
      fs.writeFileSync(script, source)

      return {dir, script}
    }

    it('ends what the manager started, the way a postinstall would run', async () => {
      const {dir, script} = standIn(`
        const {spawn} = require('node:child_process')
        const late = spawn(process.execPath, ['-e', ${JSON.stringify(
          "require('node:fs').writeFileSync(process.argv[2], '1'); setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'late'), Number(process.argv[3]))"
        )}, process.argv[2], process.argv[3], '${LATE_MS}'], {stdio: 'ignore'})
        require('node:fs').writeSync(1, late.pid + '\\n')
        setInterval(() => {}, 1000)
      `)
      const marker = path.join(dir, 'postinstall-ran')
      const ready = path.join(dir, 'postinstall-started')

      holdTimeouts()
      const result = await settleOnceReady(
        runInstall(process.execPath, [script, marker, ready], {
          cwd: dir,
          stdio: 'pipe',
          timeoutMs: 500
        }),
        () => fs.existsSync(ready)
      )
      vi.useRealTimers()

      const grandchild = Number(result.stdout.trim())
      expect(grandchild).toBeGreaterThan(0)
      started.push(grandchild)

      await vi.waitFor(() => expect(isRunning(grandchild)).toBe(false), {
        timeout: 5000,
        interval: 50
      })

      started.splice(started.indexOf(grandchild), 1)
      // Ended before its own timer ran out, so it can never write now.
      expect(fs.existsSync(marker)).toBe(false)
    }, 20_000)

    // Windows has no SIGTERM to ignore: taskkill /F ends the tree at once,
    // and the grace before SIGKILL is never started there.
    it.skipIf(process.platform === 'win32')(
      'kills a manager that ignores SIGTERM once the grace runs out',
      async () => {
        const {dir, script} = standIn(`
        process.on('SIGTERM', () => {})
        require('node:fs').writeSync(1, process.pid + '\\n')
        require('node:fs').writeFileSync(process.argv[2], '1')
        setInterval(() => {}, 1000)
      `)
        const ready = path.join(dir, 'manager-started')

        holdTimeouts()
        const result = await settleOnceReady(
          runInstall(process.execPath, [script, ready], {
            cwd: dir,
            stdio: 'pipe',
            timeoutMs: 500
          }),
          () => fs.existsSync(ready)
        )
        // The grace before SIGKILL is held too, and runs out here.
        vi.advanceTimersByTime(KILL_GRACE_MS)
        vi.useRealTimers()

        const pid = Number(result.stdout.trim())
        expect(pid).toBeGreaterThan(0)
        started.push(pid)

        await vi.waitFor(() => expect(isRunning(pid)).toBe(false), {
          timeout: 8000,
          interval: 50
        })

        started.splice(started.indexOf(pid), 1)
      },
      20_000
    )
  })

  // The control variable is the point: a lane where no npm_config_* reaches the
  // child reads "unset" for the stripped key too, and the assertion would then
  // pass while proving nothing.
  it('keeps an inherited release-age rule out of the project install', async () => {
    const saved = process.env.npm_config_minimum_release_age
    process.env.npm_config_minimum_release_age = '4320'
    process.env.npm_config_release_age_control = 'reached'

    try {
      const result = await runInstall(
        process.execPath,
        [
          '-p',
          'JSON.stringify([process.env.npm_config_release_age_control ?? "lost", process.env.npm_config_minimum_release_age ?? "unset"])'
        ],
        {cwd: process.cwd(), stdio: 'pipe'}
      )

      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout.trim())).toEqual(['reached', 'unset'])
    } finally {
      delete process.env.npm_config_release_age_control

      if (saved === undefined) {
        delete process.env.npm_config_minimum_release_age
      } else {
        process.env.npm_config_minimum_release_age = saved
      }
    }
  })
})
