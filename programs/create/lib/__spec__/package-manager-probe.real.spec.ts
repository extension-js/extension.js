import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  declarePackageManager,
  type VersionProbe,
  versionProbeWith
} from '../package-manager'

// Only the manager is a stand-in here. The product code and cross-spawn
// start a real child, through a .cmd shim on Windows.
const ATTEMPT_ENV = 'EXTJS_SPEC_PROBE_ATTEMPT'
// Far past any limit a test hands the probe, and short enough that a child
// nothing ended is gone soon after.
const HANG = 'setTimeout(() => {}, 8000)'
const dirs: string[] = []

beforeEach(() => {
  vi.stubEnv('npm_config_user_agent', '')
})

afterEach(() => {
  vi.unstubAllEnvs()

  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

function tempDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `extjs-probe-${label}-`))
  dirs.push(dir)

  return dir
}

// Writes a manager named `name` into a new folder and nowhere else. The
// launcher runs `body` on this Node, so it behaves the same on every host.
function standInManager(name: string, body: string): string {
  const dir = tempDir('bin')
  const script = path.join(dir, 'answer.mjs')
  fs.writeFileSync(script, `${body}\n`)

  if (process.platform === 'win32') {
    fs.writeFileSync(
      path.join(dir, `${name}.cmd`),
      `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
    )
  } else {
    fs.writeFileSync(
      path.join(dir, name),
      `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
      {mode: 0o755}
    )
  }

  return dir
}

// The probe the create uses, on a PATH that holds the stand-in folder alone.
// `limitsMs` cuts short an attempt that is meant to run out of time.
function probeOn(binDir: string, limitsMs: Array<number | undefined> = []) {
  const asked: Array<number | undefined> = []
  const startManager = versionProbeWith()

  const probe: VersionProbe = (command, args, options) => {
    asked.push(options.timeout)
    const env = {...options.env} as NodeJS.ProcessEnv

    // Windows spells the variable Path, and two spellings would both reach it.
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === 'path') delete env[key]
    }

    env.PATH = binDir
    env[ATTEMPT_ENV] = String(asked.length)

    return startManager(command, args, {
      ...options,
      timeout: limitsMs[asked.length - 1] ?? options.timeout,
      env
    })
  }

  return {probe, asked}
}

function unpinnedProject(): string {
  const dir = tempDir('project')
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"unpinned"}\n')

  return dir
}

// A real child on a loaded runner can take seconds to start, and none of
// these tests is about how fast that is.
describe('the version probe against a real child', {timeout: 60_000}, () => {
  it('reads the version a manager prints', async () => {
    const {probe, asked} = probeOn(
      standInManager('npm', "console.log('10.9.2')")
    )

    expect(
      await declarePackageManager(unpinnedProject(), 'npm', probe)
    ).toEqual({
      spec: 'npm@10.9.2'
    })

    expect(asked).toEqual([5000])
  })

  it('starts the manager itself when no probe is handed in', async () => {
    // The default probe reads the PATH of this process, changed for this test
    // only and put back by afterEach.
    vi.stubEnv('PATH', standInManager('npm', "console.log('10.9.2')"))

    expect(await declarePackageManager(unpinnedProject(), 'npm')).toEqual({
      spec: 'npm@10.9.2'
    })
  })

  // Windows asks from the starting folder, so a template cannot answer.
  it.skipIf(process.platform === 'win32')(
    'lets a shim answer for the project folder it is started in',
    async () => {
      // Stands in for a shim that picks its version from the nearest manifest.
      const {probe} = probeOn(
        standInManager(
          'pnpm',
          "import {readFileSync} from 'node:fs'\n" +
            "let name = ''\n" +
            "try { name = JSON.parse(readFileSync('package.json', 'utf8')).name } catch {}\n" +
            "console.log(name === 'unpinned' ? '9.9.9' : '8.0.0')"
        )
      )

      expect(
        await declarePackageManager(unpinnedProject(), 'pnpm', probe)
      ).toEqual({
        spec: 'pnpm@9.9.9'
      })
    }
  )

  it('declares the manager when it is slow once and then answers', async () => {
    const {probe, asked} = probeOn(
      standInManager(
        'npm',
        `if (process.env.${ATTEMPT_ENV} === '1') ${HANG}\nelse console.log('10.9.2')`
      ),
      // Only the first attempt is cut short. The second keeps the real limit.
      [300]
    )

    expect(
      await declarePackageManager(unpinnedProject(), 'npm', probe)
    ).toEqual({
      spec: 'npm@10.9.2'
    })

    expect(asked).toEqual([5000, 15000])
  })

  it('reports a timeout when the manager never answers', async () => {
    const {probe, asked} = probeOn(standInManager('npm', HANG), [300, 300])

    expect(
      await declarePackageManager(unpinnedProject(), 'npm', probe)
    ).toEqual({
      undeclared: {kind: 'timeout', seconds: 15}
    })

    expect(asked).toEqual([5000, 15000])
  })

  it('ends the manager that ran out of time, not only its launcher', async () => {
    // The stand-in names itself in a file of its own folder, then hangs.
    const pidFile = path.join(tempDir('pid'), 'manager.pid')
    const {probe} = probeOn(
      standInManager(
        'npm',
        "import {writeFileSync} from 'node:fs'\n" +
          `writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))\n` +
          HANG
      ),
      // The second attempt has time to start and write the file.
      [300, 4000]
    )

    expect(
      await declarePackageManager(unpinnedProject(), 'npm', probe)
    ).toEqual({undeclared: {kind: 'timeout', seconds: 15}})

    const pid = Number(fs.readFileSync(pidFile, 'utf8'))
    expect(pid).toBeGreaterThan(0)

    // Signal 0 only asks whether the stand-in this test started still runs,
    // and the wait ends well before the stand-in would stop by itself.
    await vi.waitFor(
      () => {
        expect(() => process.kill(pid, 0)).toThrow(/ESRCH/)
      },
      {timeout: 2000, interval: 100}
    )
  })

  it('asks twice, then reports no version, when a clean exit prints nothing', async () => {
    const {probe, asked} = probeOn(standInManager('npm', ''))

    expect(
      await declarePackageManager(unpinnedProject(), 'npm', probe)
    ).toEqual({
      undeclared: {kind: 'no-version'}
    })

    expect(asked).toHaveLength(2)
  })

  it('reads the version after a warning line on stdout', async () => {
    const {probe, asked} = probeOn(
      standInManager(
        'pnpm',
        "console.log('WARN  a newer release is available: 99.0.0')\nconsole.log('9.9.9')"
      )
    )

    expect(
      await declarePackageManager(unpinnedProject(), 'pnpm', probe)
    ).toEqual({
      spec: 'pnpm@9.9.9'
    })

    expect(asked).toHaveLength(1)
  })

  it('ignores what the manager writes to stderr', async () => {
    const {probe} = probeOn(
      standInManager(
        'npm',
        "console.error('npm notice New major version of npm available! 99.0.0')\nconsole.log('10.9.2')"
      )
    )

    expect(
      await declarePackageManager(unpinnedProject(), 'npm', probe)
    ).toEqual({
      spec: 'npm@10.9.2'
    })
  })

  it('reports the exit code of a manager that fails, and asks once', async () => {
    const {probe, asked} = probeOn(
      standInManager('yarn', "console.log('1.22.22')\nprocess.exitCode = 3")
    )

    expect(
      await declarePackageManager(unpinnedProject(), 'yarn', probe)
    ).toEqual({
      undeclared: {kind: 'exit', code: 3}
    })

    expect(asked).toHaveLength(1)
  })

  it('reports a manager that is not on PATH, and asks once', async () => {
    // The folder holds an npm stand-in only, so bun is nowhere on this PATH.
    const {probe, asked} = probeOn(
      standInManager('npm', "console.log('10.9.2')")
    )

    expect(
      await declarePackageManager(unpinnedProject(), 'bun', probe)
    ).toEqual({
      undeclared: {kind: 'missing'}
    })

    expect(asked).toHaveLength(1)
  })
})
