import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {plantBrowserStandIn} from '../helpers/browser-stand-in'
import {
  type CliSession,
  everyLineAsFrame,
  runCli,
  startCli
} from '../helpers/run-cli'

interface Frame {
  ok: boolean
  status: string
  value: {readyCode?: string} | null
  error: {code: string; message: string} | null
}

// The helper turns the system scan off and gives each run an empty cache
// and a temp home, so no case can reach a browser this machine has.
const OUTPUT_ENV = {EXTENSION_OUTPUT: 'json'}

// A Gecko that answers its version, then opens the debugger port it is
// told to and answers it in the mode given. It never loads anything.
function plantFakeGecko(
  dir: string,
  debuggerServer: 'close' | 'garbage' | 'silent'
): string {
  return plantBrowserStandIn(dir, 'fake-gecko', {
    version: 'Mozilla Firefox 140.0.1',
    debuggerServer
  })
}

type Session = {
  cli: CliSession
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
  const cli = startCli(
    ['dev', projectDir, '--browser', browser, '--output', 'json', ...args],
    {env: {...OUTPUT_ENV, ...env}}
  )
  const readyPath = join(
    projectDir,
    'dist',
    'extension-js',
    browser,
    'ready.json'
  )

  return {
    cli,
    frames: () => everyLineAsFrame<Frame>(cli.read().stdout),
    stderr: () => cli.read().stderr,
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
      await cli.stop('SIGTERM', 3000)
    }
  }
}

async function waitForFailureFrame(
  session: Session,
  timeoutMs = 90_000
): Promise<Frame> {
  const failed = () => session.frames().find((frame) => !frame.ok)

  await session.cli.waitFor(
    () => failed() !== undefined,
    timeoutMs,
    'a failure frame'
  )

  return failed() as Frame
}

async function runWaiter(
  projectDir: string,
  browser: string,
  env: Record<string, string> = {}
) {
  const result = await runCli(
    [
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
    {env: {...OUTPUT_ENV, ...env}}
  )
  const lines = everyLineAsFrame<Frame>(result.stdout)

  return {
    status: result.status,
    frame: lines[lines.length - 1],
    lineCount: lines.length
  }
}

describe('a launcher refusal names its code on the stream, the contract and --wait', () => {
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
    status: 'usage' | 'ready-failed'
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

    const waiter = await runWaiter(projectDir, 'chromium-based')
    expect(waiter.status).toBe(1)
    expect(waiter.lineCount).toBe(1)
    expect(waiter.frame).toMatchObject({
      ok: false,
      command: 'dev',
      status: 'usage',
      error: {code: 'E_BROWSER_BINARY_REQUIRED'}
    })
  }, 120_000)

  // The variable is a choice like the flag, so a path that names nothing
  // is a bad value and never reads as a browser that is not installed.
  it('a binary variable that names nothing ends in E_BROWSER_BINARY_INVALID as usage', async () => {
    const {work, projectDir} = makeWorkspace()
    const emptyCache = join(work, 'browsers')
    mkdirSync(emptyCache, {recursive: true})
    const missing = join(work, 'nowhere', 'edge')
    const env = {
      EXT_BROWSERS_CACHE_DIR: emptyCache,
      EDGE_BINARY: missing
    }

    session = startDev(projectDir, 'edge', [], env)
    await expectLaunchRefusal(session, 'E_BROWSER_BINARY_INVALID', 'usage')
    expect(session.stderr()).toMatch(/EDGE_BINARY/)
    expect(session.stderr()).toContain(missing)
    expect(session.stderr()).not.toMatch(/isn't installed/)

    const waiter = await runWaiter(projectDir, 'edge', env)
    expect(waiter.status).toBe(1)
    expect(waiter.lineCount).toBe(1)
    expect(waiter.frame).toMatchObject({
      ok: false,
      command: 'dev',
      status: 'usage',
      error: {code: 'E_BROWSER_BINARY_INVALID'}
    })
  }, 120_000)

  // No browser can start here, and the session keeps serving for the next
  // compile to retry: ready-failed. The waiter's own run ends, so failed.
  it.each([
    'chrome',
    'firefox'
  ])('%s found nowhere ends in E_BROWSER_NOT_FOUND as failed', async (browser) => {
    const {work, projectDir} = makeWorkspace()
    const emptyCache = join(work, 'browsers')
    mkdirSync(emptyCache, {recursive: true})
    const env = {
      EXT_BROWSERS_CACHE_DIR: emptyCache,
      EXTENSION_INTERNAL_SKIP_SYSTEM_BROWSERS: '1',
      CHROME_FOR_TESTING_PATH: '',
      CHROMIUM_BINARY: '',
      CHROME_BINARY: '',
      FIREFOX_BINARY: ''
    }
    const reason = `${browser} isn't installed and no binary was found`

    session = startDev(projectDir, browser, [], env)
    const frame = await waitForFailureFrame(session)
    await expectLaunchRefusal(session, 'E_BROWSER_NOT_FOUND', 'ready-failed')
    expect(frame.error?.message).toContain(reason)
    expect(session.stderr()).toMatch(
      /isn't available in the managed browser cache/
    )

    expect(session.stderr()).toContain(`extension install ${browser}`)
    expect(session.stderr()).toContain(reason)
    expect(session.ready()?.browserPid).toBeUndefined()

    const waiter = await runWaiter(projectDir, browser, env)
    expect(waiter.status).toBe(1)
    expect(waiter.lineCount).toBe(1)
    expect(waiter.frame).toMatchObject({
      ok: false,
      command: 'dev',
      status: 'failed',
      error: {code: 'E_BROWSER_NOT_FOUND'}
    })

    expect(waiter.frame.error?.message).toContain(reason)
  }, 120_000)

  it.each([
    ['close', 'E_BROWSER_CONNECTION_CLOSED', /closed unexpectedly/],
    ['garbage', 'E_RDP_PROTOCOL', /Invalid RDP frame length/],
    ['silent', 'E_BROWSER_START_TIMEOUT', /sent no RDP greeting/]
  ] as const)(
    'a gecko debugger that answers in mode %s ends in %s',
    async (mode, code, reason) => {
      const {work, projectDir} = makeWorkspace()
      const binary = plantFakeGecko(join(work, 'bin'), mode)

      session = startDev(projectDir, 'firefox', ['--gecko-binary', binary], {
        // Each of the five setup attempts waits this long for a greeting,
        // and only the silent mode ever reaches the end of it.
        EXTENSION_RDP_REQUEST_TIMEOUT_MS: mode === 'silent' ? '250' : '1000'
      })

      await expectLaunchRefusal(session, code, 'ready-failed')
      expect(String(session.ready()?.browserLaunchFailedReason)).toMatch(reason)
    },
    150_000
  )

  it('a LibreWolf with remote debugging locked off ends in E_BROWSER_CONNECT as failed', async () => {
    const {work, projectDir} = makeWorkspace()
    const binary = plantFakeGecko(join(work, 'bin'), 'silent')
    const home = join(work, 'home')
    mkdirSync(home, {recursive: true})

    session = startDev(projectDir, 'librewolf', ['--gecko-binary', binary], {
      HOME: home,
      XDG_CONFIG_HOME: ''
    })

    await expectLaunchRefusal(session, 'E_BROWSER_CONNECT', 'ready-failed')
    expect(String(session.ready()?.browserLaunchFailedReason)).toMatch(
      /keeps remote debugging off/
    )

    expect(session.stderr()).toMatch(/librewolf\.overrides\.cfg/)
  }, 120_000)
})
