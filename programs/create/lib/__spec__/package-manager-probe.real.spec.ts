import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {sync as spawnSync} from 'cross-spawn'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {declarePackageManager, type VersionProbe} from '../package-manager'

// Only the manager is a stand-in here. The product code and cross-spawn
// start a real child, through a .cmd shim on Windows.
const ATTEMPT_ENV = 'EXTJS_SPEC_PROBE_ATTEMPT'
// Far past any limit a test hands the probe, and short enough that a child
// Windows could not end with its shim is gone soon after.
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

// The real cross-spawn, on a PATH that holds the stand-in folder alone.
// `limitsMs` cuts short an attempt that is meant to run out of time.
function probeOn(binDir: string, limitsMs: Array<number | undefined> = []) {
  const asked: Array<number | undefined> = []

  const probe: VersionProbe = (command, args, options) => {
    asked.push(options.timeout)
    const env = {...options.env} as NodeJS.ProcessEnv

    // Windows spells the variable Path, and two spellings would both reach it.
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === 'path') delete env[key]
    }

    env.PATH = binDir
    env[ATTEMPT_ENV] = String(asked.length)

    return spawnSync(command, args, {
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
  it('reads the version a manager prints', () => {
    const {probe, asked} = probeOn(
      standInManager('npm', "console.log('10.9.2')")
    )

    expect(declarePackageManager(unpinnedProject(), 'npm', probe)).toEqual({
      spec: 'npm@10.9.2'
    })

    expect(asked).toEqual([5000])
  })

  it('starts the manager itself when no probe is handed in', () => {
    // The default probe reads the PATH of this process, changed for this test
    // only and put back by afterEach.
    vi.stubEnv('PATH', standInManager('npm', "console.log('10.9.2')"))

    expect(declarePackageManager(unpinnedProject(), 'npm')).toEqual({
      spec: 'npm@10.9.2'
    })
  })

  it('declares the manager when it is slow once and then answers', () => {
    const {probe, asked} = probeOn(
      standInManager(
        'npm',
        `if (process.env.${ATTEMPT_ENV} === '1') ${HANG}\nelse console.log('10.9.2')`
      ),
      // Only the first attempt is cut short. The second keeps the real limit.
      [300]
    )

    expect(declarePackageManager(unpinnedProject(), 'npm', probe)).toEqual({
      spec: 'npm@10.9.2'
    })

    expect(asked).toEqual([5000, 15000])
  })

  it('reports a timeout when the manager never answers', () => {
    const {probe, asked} = probeOn(standInManager('npm', HANG), [300, 300])

    expect(declarePackageManager(unpinnedProject(), 'npm', probe)).toEqual({
      undeclared: {kind: 'timeout', seconds: 15}
    })

    expect(asked).toEqual([5000, 15000])
  })

  it('asks twice, then reports no version, when a clean exit prints nothing', () => {
    const {probe, asked} = probeOn(standInManager('npm', ''))

    expect(declarePackageManager(unpinnedProject(), 'npm', probe)).toEqual({
      undeclared: {kind: 'no-version'}
    })

    expect(asked).toHaveLength(2)
  })

  it('reads the version after a warning line on stdout', () => {
    const {probe, asked} = probeOn(
      standInManager(
        'pnpm',
        "console.log('WARN  a newer release is available: 99.0.0')\nconsole.log('9.9.9')"
      )
    )

    expect(declarePackageManager(unpinnedProject(), 'pnpm', probe)).toEqual({
      spec: 'pnpm@9.9.9'
    })

    expect(asked).toHaveLength(1)
  })

  it('ignores what the manager writes to stderr', () => {
    const {probe} = probeOn(
      standInManager(
        'npm',
        "console.error('npm notice New major version of npm available! 99.0.0')\nconsole.log('10.9.2')"
      )
    )

    expect(declarePackageManager(unpinnedProject(), 'npm', probe)).toEqual({
      spec: 'npm@10.9.2'
    })
  })

  it('reports the exit code of a manager that fails, and asks once', () => {
    const {probe, asked} = probeOn(
      standInManager('yarn', "console.log('1.22.22')\nprocess.exitCode = 3")
    )

    expect(declarePackageManager(unpinnedProject(), 'yarn', probe)).toEqual({
      undeclared: {kind: 'exit', code: 3}
    })

    expect(asked).toHaveLength(1)
  })

  it('reports a manager that is not on PATH, and asks once', () => {
    // The folder holds an npm stand-in only, so bun is nowhere on this PATH.
    const {probe, asked} = probeOn(
      standInManager('npm', "console.log('10.9.2')")
    )

    expect(declarePackageManager(unpinnedProject(), 'bun', probe)).toEqual({
      undeclared: {kind: 'missing'}
    })

    expect(asked).toHaveLength(1)
  })
})
