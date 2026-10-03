import {spawn, spawnSync} from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, describe, expect, it} from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const cliRoot = resolve(__dirname, '../..')
const cliBin = resolve(cliRoot, 'dist', 'cli.cjs')
const ANSI = /\x1b\[[0-9;]*m/g

function stripVitestEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    EXTENSION_ENV: 'test',
    EXTENSION_TELEMETRY: '0',
    ...extra
  }
  delete env.VITEST
  delete env.VITEST_WORKER_ID

  return env
}

// A file that exists but cannot be executed: the shape of a truncated
// download or a binary with lost permissions. spawn refuses it with EACCES,
// so nothing is on screen and no browser is needed.
function plantUnexecutableBinary(dir: string, name: string): string {
  const binary = join(dir, name)
  mkdirSync(dir, {recursive: true})
  writeFileSync(binary, 'not a browser\n')
  chmodSync(binary, 0o644)

  return binary
}

function writeProject(dir: string) {
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Launch Probe',
      version: '1.0.0'
    })
  )
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function sessionPaths(projectDir: string, browser: string) {
  const dir = join(projectDir, 'dist', 'extension-js', browser)

  return {
    readyPath: join(dir, 'ready.json'),
    eventsPath: join(dir, 'events.ndjson')
  }
}

type Session = {
  output: () => string
  ready: () => Record<string, unknown> | null
  events: () => string
  stop: () => Promise<void>
}

function startDev(
  projectDir: string,
  browser: string,
  args: string[]
): Session {
  const child = spawn(
    process.execPath,
    [cliBin, 'dev', projectDir, '--browser', browser, ...args],
    {cwd: cliRoot, stdio: 'pipe', env: stripVitestEnv()}
  )
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk.toString()))
  child.stderr.on('data', (chunk) => (output += chunk.toString()))

  const {readyPath, eventsPath} = sessionPaths(projectDir, browser)

  return {
    output: () => output.replace(ANSI, ''),
    ready: () => readJson(readyPath),
    events: () =>
      existsSync(eventsPath) ? readFileSync(eventsPath, 'utf8') : '',
    async stop() {
      child.kill('SIGTERM')
      await Promise.race([
        new Promise((resolvePromise) => child.once('close', resolvePromise)),
        sleep(3000).then(() => child.kill('SIGKILL'))
      ])
    }
  }
}

// The failure lands in three places: the human block, the contract and the
// events timeline (a one second poll). Wait for all three or give up.
async function waitForLaunchFailure(session: Session, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const ready = session.ready()

    if (
      typeof ready?.browserLaunchFailedAt === 'string' &&
      session.events().includes('"browser_launch_failed"') &&
      /couldn't start/.test(session.output())
    ) {
      break
    }

    await sleep(250)
  }

  // A ready line, were one printed, would follow the failure block by less
  // than a tick, so let the transcript settle before reading it.
  await sleep(1000)
}

function runWaiter(projectDir: string, browser: string) {
  const result = spawnSync(
    process.execPath,
    [
      cliBin,
      'dev',
      projectDir,
      '--browser',
      browser,
      '--wait',
      '--output',
      'json',
      '--wait-timeout',
      '15000'
    ],
    {cwd: cliRoot, encoding: 'utf8', env: stripVitestEnv()}
  )

  return {
    status: result.status,
    stdout: result.stdout.replace(ANSI, ''),
    stderr: result.stderr.replace(ANSI, '')
  }
}

// The stand-in binaries lean on posix permission bits, which Windows does
// not model, so the contract runs on posix only. The stamp is platform-neutral.
describe.skipIf(process.platform === 'win32')(
  'dev with a browser that never spawns',
  () => {
    const leftovers: string[] = []
    let session: Session | undefined

    afterEach(async () => {
      await session?.stop()
      session = undefined

      for (const dir of leftovers.splice(0)) {
        rmSync(dir, {recursive: true, force: true})
      }
    })

    function makeWorkspace() {
      const work = mkdtempSync(join(tmpdir(), 'extjs-launch-failed-'))
      leftovers.push(work)
      const projectDir = join(work, 'project')
      mkdirSync(projectDir, {recursive: true})
      writeProject(projectDir)

      return {work, projectDir}
    }

    it('reports the chromium spawn refusal on the contract, prints no ready line, and --wait exits with E_BROWSER_LAUNCH', async () => {
      const {work, projectDir} = makeWorkspace()
      const binary = plantUnexecutableBinary(join(work, 'bin'), 'chrome')

      session = startDev(projectDir, 'chrome', ['--chromium-binary', binary])
      await waitForLaunchFailure(session)

      const output = session.output()
      expect(output, output).toMatch(/Launch Probe compiled in \d+ ms/)
      expect(output, output).toMatch(
        /Chrome couldn't start, so the extension isn't running/
      )

      expect(output, output).toMatch(/EACCES/)
      expect(output, output).toMatch(/The dev server keeps watching/)
      expect(output, output).not.toMatch(/ready for development/)
      expect(output, output).not.toMatch(/Uncaught exception/)

      const ready = session.ready()
      expect(ready, output).not.toBeNull()
      expect(ready?.status).toBe('error')
      expect(ready?.code).toBe('browser_launch_failed')
      expect(String(ready?.message)).toMatch(/could not start/)
      expect(String(ready?.message)).toMatch(/EACCES/)
      expect(String(ready?.message)).toMatch(/nothing is running/)
      expect(typeof ready?.browserLaunchFailedAt).toBe('string')
      expect(String(ready?.browserLaunchFailedReason)).toContain(binary)
      expect(ready?.browserPid).toBeUndefined()

      const events = session.events()
      expect(events, events).toMatch(/"type":"browser_launch_failed"/)
      expect(events, events).toMatch(/"reason":"spawn /)

      // The second process a consumer runs: it must not be told the session
      // is up while nothing can load.
      const waiter = runWaiter(projectDir, 'chrome')
      expect(waiter.status, waiter.stderr).toBe(1)
      const lines = waiter.stdout.split('\n').filter((line) => line.trim())
      expect(lines, waiter.stdout).toHaveLength(1)
      const frame = JSON.parse(lines[0]) as Record<string, unknown>
      expect(frame).toMatchObject({
        schema: 1,
        ok: false,
        command: 'dev',
        status: 'failed'
      })

      const error = frame.error as {code: string; message: string}
      expect(error.code).toBe('E_BROWSER_LAUNCH')
      expect(error.message).toMatch(/EACCES/)
    }, 120_000)

    it('names a --chromium-binary path that does not exist', async () => {
      const {work, projectDir} = makeWorkspace()
      const missing = join(work, 'nowhere', 'chrome')

      session = startDev(projectDir, 'chrome', ['--chromium-binary', missing])
      await waitForLaunchFailure(session)

      const output = session.output()
      expect(output, output).toMatch(
        /Chrome couldn't start, so the extension isn't running/
      )

      expect(output, output).toMatch(/Can't find a Chromium binary/)
      expect(output, output).not.toMatch(/ready for development/)

      const ready = session.ready()
      expect(ready?.status).toBe('error')
      expect(ready?.code).toBe('browser_launch_failed')
      expect(String(ready?.message)).toContain(missing)
      // The human frame's glyph and line breaks stay out of the contract.
      expect(String(ready?.message)).not.toMatch(/\n|⏵/)
      expect(session.events(), session.events()).toMatch(
        /"type":"browser_launch_failed"/
      )
    }, 120_000)

    it('reports the firefox spawn refusal the same way', async () => {
      const {work, projectDir} = makeWorkspace()
      const binary = plantUnexecutableBinary(join(work, 'bin'), 'firefox')

      session = startDev(projectDir, 'firefox', ['--gecko-binary', binary])
      await waitForLaunchFailure(session)

      const output = session.output()
      expect(output, output).toMatch(
        /Firefox couldn't start, so the extension isn't running/
      )

      expect(output, output).toMatch(/EACCES/)
      expect(output, output).not.toMatch(/ready for development/)

      const ready = session.ready()
      expect(ready?.status).toBe('error')
      expect(ready?.code).toBe('browser_launch_failed')
      expect(String(ready?.message)).toMatch(/firefox process could not start/)
      expect(String(ready?.browserLaunchFailedReason)).toContain(binary)
      expect(session.events(), session.events()).toMatch(
        /"type":"browser_launch_failed"/
      )
    }, 120_000)
  }
)
