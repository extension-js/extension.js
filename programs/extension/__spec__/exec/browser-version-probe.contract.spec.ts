import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import {join} from 'node:path'
import {beforeAll, describe, expect, it} from 'vitest'
import {plantBrowserStandIn} from '../helpers/browser-stand-in'
import {
  type CliRun,
  framesIn,
  freshCliHome,
  runCli,
  startCli
} from '../helpers/run-cli'
import {trackTempFolders} from '../helpers/temp-folders'

interface Frame {
  ok: boolean
  command: string
  status: string
  error: {code: string; message: string} | null
}

type Command = 'start' | 'preview' | 'dev'
type Browser = 'chrome' | 'firefox'

interface Waiter {
  status: number | null
  frames: Frame[]
}

interface ProbeRun {
  binary: string
  status: number | null
  stdout: string
  stderr: string
  frames: Frame[]
  // From the spawn of the CLI to its exit.
  elapsedMs: number
  // From the stand-in writing its pid to the exit of the CLI.
  probeWindowMs: number
  // The stand-in and the child it started, and whether each one ended.
  tree: Array<{pid: number; ended: boolean}>
  ready: Record<string, unknown> | null
  // start only: the contract once compiled, and the two waiters.
  compiled?: Record<string, unknown> | null
  firstRunningWhenWaiterStarted?: boolean
  waitedDuring?: Waiter
  waitedAfter?: Waiter
}

const PROBE_SECONDS = 10
// Windows ends the tree through taskkill, which the CLI starts and does not
// wait on, so the pids outlive the CLI by a few seconds there.
const TREE_END_MS = process.platform === 'win32' ? 10_000 : 2_000
const EXIT_CEILING_MS = 100_000

// Every surface reads one run per command and engine, so the 10 second
// bound, which no flag shortens, is waited once here and not once per test.
const CASES: Array<[Command, Browser, string]> = [
  ['start', 'chrome', '--chromium-binary'],
  ['start', 'firefox', '--gecko-binary'],
  ['preview', 'chrome', '--chromium-binary'],
  ['preview', 'firefox', '--gecko-binary'],
  ['dev', 'chrome', '--chromium-binary']
]

const makeTemp = trackTempFolders()

// Asked for its version it never answers, through a child of its own, the
// shape of a wrapper around a browser that hangs.
function plantHangingBinary(dir: string, name: string) {
  const pidFile = join(dir, `${name}.pid`)
  const childPidFile = join(dir, `${name}.child.pid`)
  const binary = plantBrowserStandIn(dir, name, {pidFile, childPidFile})

  return {binary, pidFile, childPidFile}
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

async function endedWithin(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms

  while (isAlive(pid)) {
    if (Date.now() > deadline) return false

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
  }

  return true
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function asWaiter(run: CliRun): Waiter {
  return {status: run.status, frames: framesIn<Frame>(run.stdout)}
}

// The pin is a stand-in in a temp folder: no browser is looked for.
async function probeRun(
  command: Command,
  browser: Browser,
  flag: string
): Promise<ProbeRun> {
  // A home of its own, since the runs of this file overlap in time.
  const home = freshCliHome()
  const work = makeTemp('extjs-version-probe-')
  const projectDir = join(work, 'project')
  mkdirSync(projectDir, {recursive: true})
  writeFileSync(
    join(projectDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Version Probe',
      version: '1.0.0'
    })
  )

  const stand = plantHangingBinary(join(work, 'bin'), browser)
  const readyPath = join(
    projectDir,
    'dist',
    'extension-js',
    browser,
    'ready.json'
  )
  const wait = (timeoutMs: number) =>
    runCli(
      [
        'start',
        projectDir,
        '--browser',
        browser,
        '--wait',
        `--wait-timeout=${timeoutMs}`,
        '--output',
        'json'
      ],
      {home, timeoutMs: EXIT_CEILING_MS}
    ).then(asWaiter)
  const args = [
    command,
    projectDir,
    '--browser',
    browser,
    flag,
    stand.binary,
    '--no-open',
    '--output',
    'json'
  ]
  const started = Date.now()
  const session = startCli(args, {home})
  const ceiling = setTimeout(() => session.killGroup(), EXIT_CEILING_MS)
  const run: Partial<ProbeRun> = {binary: stand.binary}

  try {
    if (command === 'start') {
      await session.waitFor(
        () => typeof readJson(readyPath)?.compiledAt === 'string',
        60_000,
        'a compiled ready.json'
      )

      run.compiled = readJson(readyPath)
      run.firstRunningWhenWaiterStarted = session.child.exitCode === null
      run.waitedDuring = await wait(30_000)
    }

    // dev keeps serving after a launch it could not make, so its run ends
    // once the failure frame is out. start and preview end by themselves.
    if (command === 'dev') {
      await session.waitFor(
        () => session.read().stdout.includes('"ok":false'),
        EXIT_CEILING_MS,
        'the failure frame'
      )

      session.killGroup()
    }

    const {status} = await session.closed
    const ended = Date.now()
    const output = session.read()

    run.status = status
    run.stdout = output.stdout
    run.stderr = output.stderr
    run.frames = framesIn<Frame>(output.stdout)
    run.elapsedMs = ended - started
    run.probeWindowMs = existsSync(stand.pidFile)
      ? ended - statSync(stand.pidFile).mtimeMs
      : Number.NaN

    run.ready = readJson(readyPath)

    if (command === 'start') run.waitedAfter = await wait(20_000)
  } finally {
    clearTimeout(ceiling)
    session.killGroup()
    run.tree = []

    // The probe gives the stand-in a group of its own, which the kill above
    // does not reach, so a pid still alive here is ended by number.
    for (const file of [stand.pidFile, stand.childPidFile]) {
      if (!existsSync(file)) continue

      const pid = Number(readFileSync(file, 'utf8').trim())
      const ended = await endedWithin(pid, TREE_END_MS)

      run.tree.push({pid, ended})

      if (!ended) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // Already gone
        }
      }
    }
  }

  return run as ProbeRun
}

describe('a pinned browser binary that never answers its version probe', () => {
  const runs = new Map<string, Promise<ProbeRun>>()

  // Each run has its own project, home and stand-in, so they overlap. A
  // run that fails keeps its own error for the tests that read it.
  beforeAll(async () => {
    for (const [command, browser, flag] of CASES) {
      runs.set(`${command} ${browser}`, probeRun(command, browser, flag))
    }

    await Promise.allSettled(runs.values())
  }, 150_000)

  function runOf(command: Command, browser: Browser): Promise<ProbeRun> {
    const run = runs.get(`${command} ${browser}`)

    if (!run) throw new Error(`no ${command} run on ${browser}`)

    return run
  }

  const everyCase = CASES.map(([command, browser]) => [command, browser])
  const withContract = everyCase.filter(([command]) => command !== 'dev')

  it.each([
    'start',
    'dev',
    'preview'
  ] as const)('%s answers a silent chrome pin with usage and E_BROWSER_BINARY_INVALID', async (command) => {
    const run = await runOf(command, 'chrome')
    const failures = run.frames.filter((frame) => !frame.ok)

    expect(failures, run.stdout).toHaveLength(1)
    expect(failures[0]).toMatchObject({command, status: 'usage'})
    expect(failures[0].error?.code).toBe('E_BROWSER_BINARY_INVALID')
    expect(failures[0].error?.message).toContain(run.binary)
  })

  // The card probes a Chromium pin before any launcher runs, which is where
  // the refusal used to leave the contract saying ready or starting.
  it.each(
    withContract as Array<[Command, Browser]>
  )('%s on %s records the refusal a bad pin gets in ready.json', async (command, browser) => {
    const run = await runOf(command, browser)

    expect(run.status, run.stderr).toBe(1)
    expect(run.frames.at(-1)?.error?.code).toBe('E_BROWSER_BINARY_INVALID')
    expect(run.ready).toMatchObject({
      command,
      status: 'error',
      code: 'browser_launch_failed',
      browserLaunchFailedCode: 'E_BROWSER_BINARY_INVALID'
    })

    expect(run.ready?.message).toContain(run.binary)
  })

  it.each([
    'chrome',
    'firefox'
  ] as const)('start --wait on %s keeps waiting through the probe and reports the refusal', async (browser) => {
    const run = await runOf('start', browser)

    expect(run.compiled).toMatchObject({
      command: 'start',
      status: 'starting'
    })

    expect(run.firstRunningWhenWaiterStarted).toBe(true)
    expect(run.waitedDuring?.status).toBe(1)
    expect(run.waitedDuring?.frames).toHaveLength(1)
    expect(run.waitedDuring?.frames[0]).toMatchObject({
      ok: false,
      command: 'start',
      status: 'usage',
      error: {code: 'E_BROWSER_BINARY_INVALID'}
    })

    expect(run.waitedDuring?.frames[0].error?.message).toContain(run.binary)
  })

  // A waiter in another process reads the same verdict and never ok.
  it.each([
    'chrome',
    'firefox'
  ] as const)('start --wait on %s after the refusal reads the same verdict', async (browser) => {
    const run = await runOf('start', browser)

    expect(run.waitedAfter?.status).toBe(1)
    expect(run.waitedAfter?.frames).toHaveLength(1)
    expect(run.waitedAfter?.frames[0]).toMatchObject({
      ok: false,
      command: 'start',
      status: 'usage',
      error: {code: 'E_BROWSER_BINARY_INVALID'}
    })
  })

  it.each([
    'firefox',
    'chrome'
  ] as const)('ends preview on %s within the bound, with one frame that names it', async (browser) => {
    const run = await runOf('preview', browser)

    expect(run.status, run.stderr).toBe(1)
    // The bound plus the time a loaded machine takes to start the CLI.
    expect(run.elapsedMs).toBeLessThan((PROBE_SECONDS + 30) * 1000)
    // The stand-in starts after the clock does, so it sees a little less.
    expect(run.probeWindowMs).toBeGreaterThan((PROBE_SECONDS - 2) * 1000)

    const lines = run.stdout.split('\n').filter((line) => line.trim())
    expect(lines, run.stdout).toHaveLength(1)

    const frame = JSON.parse(lines[0]) as Frame
    expect(frame).toMatchObject({ok: false, command: 'preview'})
    expect(frame.error?.code).toBe('E_BROWSER_BINARY_INVALID')
    expect(frame.error?.message).toContain(run.binary)
    expect(frame.error?.message).toContain(
      `did not answer within ${PROBE_SECONDS} seconds`
    )
  })

  // Both the probed process and the child it started are gone.
  it.each(
    everyCase as Array<[Command, Browser]>
  )('%s on %s leaves nothing of the probed binary running', async (command, browser) => {
    const run = await runOf(command, browser)

    expect(run.tree).toHaveLength(2)
    expect(run.tree.filter((entry) => !entry.ended)).toEqual([])
  })
})
