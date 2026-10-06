import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import {
  chmodSync,
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

interface Frame {
  ok: boolean
  status: string
  value: {readyCode?: string} | null
  error: {code: string; message: string} | null
}

function cliEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    EXTENSION_ENV: 'test',
    EXTENSION_TELEMETRY: '0',
    EXTENSION_OUTPUT: 'json',
    ...extra
  }
  delete env.VITEST
  delete env.VITEST_WORKER_ID

  return env
}

const FAKE_GECKO = `#!/usr/bin/env node
const net = require('node:net')

if (process.argv.includes('--version')) {
  process.stdout.write('Mozilla Firefox 140.0.1\\n')
  process.exit(0)
}

const at = process.argv.indexOf('-start-debugger-server')
const port = at >= 0 ? Number(process.argv[at + 1]) : 0
const mode = process.env.FAKE_RDP_MODE

net
  .createServer((socket) => {
    socket.on('error', () => {})
    if (mode === 'close') socket.destroy()
    else if (mode === 'garbage') socket.write('xx:{}')
  })
  .listen(port, '127.0.0.1')

setInterval(() => {}, 1000)
`

function plantFakeGecko(dir: string): string {
  const binary = join(dir, 'fake-gecko.js')
  mkdirSync(dir, {recursive: true})
  writeFileSync(binary, FAKE_GECKO)
  chmodSync(binary, 0o755)

  return binary
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

type Session = {
  frames: () => Frame[]
  stderr: () => string
  ready: () => Record<string, unknown> | null
  stop: () => Promise<void>
}

function startDev(
  projectDir: string,
  browser: string,
  args: string[],
  env: Record<string, string> = {}
): Session {
  const child: ChildProcess = spawn(
    process.execPath,
    [
      cliBin,
      'dev',
      projectDir,
      '--browser',
      browser,
      '--output',
      'json',
      ...args
    ],
    {cwd: cliRoot, stdio: 'pipe', env: cliEnv(env)}
  )
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk) => (stdout += chunk.toString()))
  child.stderr?.on('data', (chunk) => (stderr += chunk.toString()))

  const readyPath = join(
    projectDir,
    'dist',
    'extension-js',
    browser,
    'ready.json'
  )

  return {
    frames: () =>
      stdout
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as Frame),
    stderr: () => stderr.replace(ANSI, ''),
    ready: () => {
      try {
        return JSON.parse(readFileSync(readyPath, 'utf8')) as Record<
          string,
          unknown
        >
      } catch {
        return null
      }
    },
    async stop() {
      child.kill('SIGTERM')
      await Promise.race([
        new Promise((resolvePromise) => child.once('close', resolvePromise)),
        sleep(3000).then(() => child.kill('SIGKILL'))
      ])
    }
  }
}

async function waitForFailureFrame(
  session: Session,
  timeoutMs = 90_000
): Promise<Frame> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const failed = session.frames().find((frame) => !frame.ok)
    if (failed) return failed

    await sleep(250)
  }

  throw new Error(`no failure frame within ${timeoutMs}ms\n${session.stderr()}`)
}

function runWaiter(
  projectDir: string,
  browser: string,
  env: Record<string, string> = {}
) {
  const result = spawnSync(
    process.execPath,
    [
      cliBin,
      'dev',
      projectDir,
      '--browser',
      browser,
      '--wait',
      '--wait-timeout',
      '15000',
      '--output',
      'json'
    ],
    {cwd: cliRoot, encoding: 'utf8', env: cliEnv(env)}
  )
  const lines = result.stdout.split('\n').filter((line) => line.trim())

  return {
    status: result.status,
    frame: JSON.parse(lines[lines.length - 1]) as Frame,
    lineCount: lines.length
  }
}

describe.skipIf(process.platform === 'win32')(
  'a launcher refusal names its code on the stream, the contract and --wait',
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
      const work = mkdtempSync(join(tmpdir(), 'extjs-launcher-codes-'))
      leftovers.push(work)
      const projectDir = join(work, 'project')
      mkdirSync(projectDir, {recursive: true})
      writeFileSync(
        join(projectDir, 'manifest.json'),
        JSON.stringify({
          manifest_version: 3,
          name: 'Launcher Codes Probe',
          version: '1.0.0'
        })
      )

      return {work, projectDir}
    }

    async function expectLaunchRefusal(
      current: Session,
      code: string,
      status: 'usage' | 'failed'
    ) {
      const frame = await waitForFailureFrame(current)

      expect(frame.status).toBe(status)
      expect(frame.error?.code).toBe(code)
      expect(frame.value?.readyCode).toBe('browser_launch_failed')

      const ready = current.ready()
      expect(ready?.status).toBe('error')
      expect(ready?.code).toBe('browser_launch_failed')
      expect(ready?.browserLaunchFailedCode).toBe(code)
      expect(String(ready?.message)).toMatch(/nothing is running/)
    }

    it('chromium-based with no binary ends in E_BROWSER_BINARY_REQUIRED as usage', async () => {
      const {projectDir} = makeWorkspace()

      session = startDev(projectDir, 'chromium-based', [])
      await expectLaunchRefusal(session, 'E_BROWSER_BINARY_REQUIRED', 'usage')
      expect(session.stderr()).toMatch(/needs a Chromium binary/)

      const waiter = runWaiter(projectDir, 'chromium-based')
      expect(waiter.status).toBe(1)
      expect(waiter.lineCount).toBe(1)
      expect(waiter.frame).toMatchObject({
        ok: false,
        command: 'dev',
        status: 'usage',
        error: {code: 'E_BROWSER_BINARY_REQUIRED'}
      })
    }, 120_000)

    it('a browser found nowhere ends in E_BROWSER_NOT_FOUND as failed', async () => {
      const {work, projectDir} = makeWorkspace()
      const emptyCache = join(work, 'browsers')
      mkdirSync(emptyCache, {recursive: true})
      const env = {
        EXT_BROWSERS_CACHE_DIR: emptyCache,
        EDGE_BINARY: join(work, 'nowhere', 'edge')
      }

      session = startDev(projectDir, 'edge', [], env)
      await expectLaunchRefusal(session, 'E_BROWSER_NOT_FOUND', 'failed')
      expect(session.stderr()).toMatch(/isn't installed and no binary/)

      const waiter = runWaiter(projectDir, 'edge', env)
      expect(waiter.status).toBe(1)
      expect(waiter.lineCount).toBe(1)
      expect(waiter.frame).toMatchObject({
        ok: false,
        command: 'dev',
        status: 'failed',
        error: {code: 'E_BROWSER_NOT_FOUND'}
      })
    }, 120_000)

    it.each([
      ['close', 'E_BROWSER_CONNECTION_CLOSED', /closed unexpectedly/],
      ['garbage', 'E_RDP_PROTOCOL', /Invalid RDP frame length/],
      ['silent', 'E_BROWSER_START_TIMEOUT', /sent no RDP greeting/]
    ])(
      'a gecko debugger that answers in mode %s ends in %s',
      async (mode, code, reason) => {
        const {work, projectDir} = makeWorkspace()
        const binary = plantFakeGecko(join(work, 'bin'))

        session = startDev(projectDir, 'firefox', ['--gecko-binary', binary], {
          FAKE_RDP_MODE: mode,
          EXTENSION_RDP_REQUEST_TIMEOUT_MS: '1000'
        })

        await expectLaunchRefusal(session, code, 'failed')
        expect(String(session.ready()?.browserLaunchFailedReason)).toMatch(
          reason
        )
      },
      150_000
    )
  }
)
