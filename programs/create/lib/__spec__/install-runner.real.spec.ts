import {describe, expect, it, vi} from 'vitest'
import {runInstall} from '../install-runner'

// Nothing is faked here on purpose: the sibling spec drives the runner
// through its spawn seam, so only this file proves what a real child does.
const VERSION = /^\d+\.\d+\.\d+/

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

  it('kills a child that outlives the timeout', async () => {
    const result = await runInstall(
      process.execPath,
      ['-e', 'console.log(process.pid); setInterval(() => {}, 1000)'],
      {cwd: process.cwd(), stdio: 'pipe', timeoutMs: 1000}
    )

    expect(result.code).toBeNull()
    expect(result.reason).toBe(
      'The install did not finish within 1 seconds (EXTENSION_CREATE_INSTALL_TIMEOUT_MS)'
    )

    // The pid the child printed before it hung is the one that must be gone.
    const pid = Number(result.stdout.trim())
    expect(pid).toBeGreaterThan(0)
    await vi.waitFor(() => expect(isRunning(pid)).toBe(false), {
      timeout: 10_000,
      interval: 50
    })
  }, 20_000)

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
