import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {StringDecoder} from 'node:string_decoder'
import {afterAll} from 'vitest'

export const CLI_ROOT = path.resolve(__dirname, '../..')
export const CLI_BIN = path.join(CLI_ROOT, 'dist', 'cli.cjs')

// Port 9 is the discard port, so the update check fails at once on loopback.
export const DEAD_REGISTRY = 'http://127.0.0.1:9/'

const ANSI = /\u001b\[[0-9;]*m/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

// What a child needs to start at all. Everything else is named by the spec.
const PASS_THROUGH = [
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'SystemDrive',
  'windir',
  'ComSpec',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'EXTJS_SPEC_REAL_TMPDIR',
  'LANG',
  'LC_ALL',
  'TZ'
]

const TEST_RUNNER_MARKERS = ['VITEST', 'VITEST_WORKER_ID', 'VITEST_POOL_ID']

export interface CliHome {
  home: string
  configHome: string
  cacheHome: string
  browsersCache: string
}

const homes: string[] = []
const live = new Set<ChildProcess>()
let fileHome: CliHome | undefined

function makeHome(): CliHome {
  const home = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-cli-home-'))
  )
  const made: CliHome = {
    home,
    configHome: path.join(home, '.config'),
    cacheHome: path.join(home, '.cache'),
    browsersCache: path.join(home, 'browsers-cache')
  }

  homes.push(home)
  fs.mkdirSync(made.configHome)
  fs.mkdirSync(made.cacheHome)
  fs.mkdirSync(made.browsersCache)

  return made
}

// One home per spec file, empty, shared by every child the file starts.
export function cliHome(): CliHome {
  fileHome ??= makeHome()

  return fileHome
}

// A home of its own, for a test that reads what one child left in it.
export function freshCliHome(): CliHome {
  return makeHome()
}

// A temp folder inside the home, removed with it. The update check caches
// its answer here for an hour, so a shared one replays it to a later child.
export function cliTempFolder(home: CliHome = cliHome()): string {
  return fs.mkdtempSync(path.join(home.home, 'tmp-'))
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return

  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
    } else {
      process.kill(-child.pid, signal)
    }
  } catch {
    // Already gone
  }
}

afterAll(() => {
  for (const child of live) killGroup(child, 'SIGKILL')
  live.clear()

  for (const home of homes.splice(0)) {
    try {
      fs.rmSync(home, {recursive: true, force: true, maxRetries: 3})
    } catch {
      // A folder still held open by a child is left for the run's cleanup.
    }
  }

  fileHome = undefined
})

// The hook above is skipped when the worker dies, and a group outlives it.
process.once('exit', () => {
  for (const child of live) killGroup(child, 'SIGKILL')
})

export interface CliEnvOptions {
  // Added last. A value of undefined removes the variable.
  env?: Record<string, string | undefined>
  // The reason this child stays on the CLI's test-runner branches.
  keepVitest?: string
  // The child may send telemetry, to the collector the spec names.
  telemetry?: boolean
  home?: CliHome
  // A folder from cliTempFolder, for children that share one on purpose.
  // Without it each child gets a folder of its own.
  tempFolder?: string
}

// Built from a list and never from the parent, so nothing the developer or
// the runner exported reaches a child unless the spec names it.
export function cliEnv(options: CliEnvOptions = {}): NodeJS.ProcessEnv {
  const home = options.home ?? cliHome()
  const tempFolder = options.tempFolder ?? cliTempFolder(home)
  const env: Record<string, string | undefined> = {}

  // Windows reads Path or PATH alike here, and the child gets one spelling.
  for (const name of PASS_THROUGH) {
    const value = process.env[name]

    if (value !== undefined) env[name] = value
  }

  if (options.keepVitest) {
    for (const name of TEST_RUNNER_MARKERS) {
      const value = process.env[name]

      if (value !== undefined) env[name] = value
    }
  }

  Object.assign(env, {
    HOME: home.home,
    USERPROFILE: home.home,
    APPDATA: path.join(home.home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home.home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: home.configHome,
    XDG_CACHE_HOME: home.cacheHome,
    EXT_BROWSERS_CACHE_DIR: home.browsersCache,
    // Unix reads TMPDIR, Windows reads TEMP, then TMP.
    TMPDIR: tempFolder,
    TEMP: tempFolder,
    TMP: tempFolder,
    npm_registry: DEAD_REGISTRY,
    // A package manager a command starts keeps its cache and store in the
    // temp home too, whatever a config file on this machine says.
    npm_config_cache: path.join(home.home, '.npm'),
    npm_config_store_dir: path.join(home.home, '.pnpm-store'),
    COREPACK_HOME: path.join(home.cacheHome, 'corepack'),
    YARN_CACHE_FOLDER: path.join(home.cacheHome, 'yarn'),
    BUN_INSTALL_CACHE_DIR: path.join(home.cacheHome, 'bun'),
    EXTENSION_INTERNAL_SKIP_SYSTEM_BROWSERS: '1',
    EXTENSION_NO_INSTALL_PROMPT: '1',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    // Node 22 warns on stderr when cli.cjs requires an ES module, and that
    // line is Node's own, so specs can compare stderr whole.
    NODE_NO_WARNINGS: '1'
  })

  if (!options.telemetry) env.EXTENSION_TELEMETRY = '0'

  for (const [name, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) Reflect.deleteProperty(env, name)
    else env[name] = value
  }

  return env as NodeJS.ProcessEnv
}

export type Frame = Record<string, unknown>

// The machine frames on a stream, whatever prose a command prints around them.
export function framesIn<T = Frame>(stdout: string): T[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as T)
}

// Every line has to be a frame: a stray prose line fails the parse.
export function everyLineAsFrame<T = Frame>(stdout: string): T[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

export interface CliOutput {
  // ANSI stripped.
  stdout: string
  stderr: string
  // Both streams in arrival order, ANSI stripped.
  output: string
  raw: {stdout: string; stderr: string}
}

export interface CliRun extends CliOutput {
  // The exit code, or null when a signal ended the child.
  status: number | null
  signal: NodeJS.Signals | null
  frames: Frame[]
}

export interface CliStartOptions extends CliEnvOptions {
  cwd?: string
}

export interface CliRunOptions extends CliStartOptions {
  timeoutMs?: number
  // Ends the child's process group once this holds: for a command that
  // keeps serving after the output under test is out.
  until?: (output: CliOutput) => boolean
  // Extra lines for the timeout error, such as where the run got to.
  describe?: () => string
}

export interface CliSession {
  child: ChildProcess
  read(): CliOutput
  frames<T = Frame>(): T[]
  closed: Promise<{status: number | null; signal: NodeJS.Signals | null}>
  // Rejects with the label and the output so far when the time runs out.
  waitFor(
    predicate: () => boolean,
    timeoutMs: number,
    label: string
  ): Promise<void>
  // Signals the CLI alone, as a terminal or a supervisor would.
  signal(signal: NodeJS.Signals): void
  // Asks the CLI to end, and kills its whole group if it has not in time.
  stop(
    signal?: NodeJS.Signals,
    graceMs?: number
  ): Promise<{status: number | null; signal: NodeJS.Signals | null}>
  killGroup(): void
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// A child that keeps running: the spec reads it, signals it and stops it.
export function startCli(
  args: string[],
  options: CliStartOptions = {}
): CliSession {
  // A missing build used to skip a whole file, or pass against an old one.
  if (!fs.existsSync(CLI_BIN)) {
    throw new Error(`${CLI_BIN} is missing: run pnpm compile first`)
  }

  const child = spawn(process.execPath, [CLI_BIN, ...args], {
    cwd: options.cwd ?? CLI_ROOT,
    env: cliEnv(options),
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group, so a stop reaches what the CLI started too.
    detached: process.platform !== 'win32',
    windowsHide: true
  })
  const raw = {stdout: '', stderr: '', output: ''}
  const decoders = {
    stdout: new StringDecoder('utf8'),
    stderr: new StringDecoder('utf8')
  }
  let ended = false

  live.add(child)

  for (const stream of ['stdout', 'stderr'] as const) {
    child[stream]?.on('data', (chunk: Buffer) => {
      const text = decoders[stream].write(chunk)

      raw[stream] += text
      raw.output += text
    })
  }

  const closed = new Promise<{
    status: number | null
    signal: NodeJS.Signals | null
  }>((resolve, reject) => {
    child.once('error', (error) => {
      ended = true
      live.delete(child)
      reject(error)
    })

    child.once('close', (status, signal) => {
      ended = true
      live.delete(child)
      resolve({status, signal})
    })
  })

  // A spec that never awaits the exit must not fail on an unhandled rejection.
  closed.catch(() => {})

  const read = (): CliOutput => ({
    stdout: stripAnsi(raw.stdout),
    stderr: stripAnsi(raw.stderr),
    output: stripAnsi(raw.output),
    raw: {stdout: raw.stdout, stderr: raw.stderr}
  })

  return {
    child,
    read,
    frames: <T = Frame>() => framesIn<T>(raw.stdout),
    closed,
    async waitFor(predicate, timeoutMs, label) {
      const deadline = Date.now() + timeoutMs

      while (!predicate()) {
        if (ended || Date.now() > deadline) {
          const why = ended ? 'the CLI ended' : `${timeoutMs} ms passed`

          throw new Error(
            `${why} before ${label}: extension ${args.join(' ')}\n` +
              read().output
          )
        }

        await sleep(50)
      }
    },
    signal(signal) {
      if (!ended) child.kill(signal)
    },
    async stop(signal = 'SIGTERM', graceMs = 5000) {
      if (!ended) child.kill(signal)

      const timer = setTimeout(() => killGroup(child, 'SIGKILL'), graceMs)

      // No kill after the exit: the group id may by then name another process.
      try {
        return await closed
      } finally {
        clearTimeout(timer)
      }
    },
    killGroup: () => killGroup(child, 'SIGKILL')
  }
}

// One CLI run to its exit. A run past its time is killed with its group
// and fails the test with what it printed.
export async function runCli(
  args: string[],
  options: CliRunOptions = {}
): Promise<CliRun> {
  const session = startCli(args, options)
  const timeoutMs = options.timeoutMs ?? 120_000
  let timedOut = false
  let stopped = false

  const timer = setTimeout(() => {
    timedOut = true
    session.killGroup()
  }, timeoutMs)

  const watch = options.until
    ? setInterval(() => {
        if (stopped || !options.until?.(session.read())) return

        stopped = true
        session.killGroup()
      }, 25)
    : undefined

  try {
    const {status, signal} = await session.closed
    const output = session.read()

    if (timedOut) {
      throw new Error(
        `the CLI did not exit within ${timeoutMs} ms: extension ` +
          `${args.join(' ')}\n${options.describe?.() ?? ''}\n` +
          `stdout:\n${output.stdout}\nstderr:\n${output.stderr}`
      )
    }

    return {
      ...output,
      status,
      signal,
      // Read on demand: stdout that is one pretty-printed document has no frames.
      get frames() {
        return session.frames()
      }
    }
  } finally {
    clearTimeout(timer)
    if (watch) clearInterval(watch)
  }
}
