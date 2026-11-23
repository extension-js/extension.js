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
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  plantBrowserStandIn,
  plantUnspawnable,
  unspawnableErrno
} from '../helpers/browser-stand-in'
import {type CliSession, runCli, startCli} from '../helpers/run-cli'

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

function sessionPaths(projectDir: string, browser: string) {
  const dir = join(projectDir, 'dist', 'extension-js', browser)

  return {
    readyPath: join(dir, 'ready.json'),
    eventsPath: join(dir, 'events.ndjson')
  }
}

type Session = {
  cli: CliSession
  output: () => string
  ready: () => Record<string, unknown> | null
  events: () => string
  stop: () => Promise<void>
}

// Every case pins a stand-in in a temp folder, so no browser is looked for.
function startDev(
  projectDir: string,
  browser: string,
  args: string[]
): Session {
  const cli = startCli(['dev', projectDir, '--browser', browser, ...args])
  const {readyPath, eventsPath} = sessionPaths(projectDir, browser)

  return {
    cli,
    output: () => cli.read().output,
    ready: () => readJson(readyPath),
    events: () =>
      existsSync(eventsPath) ? readFileSync(eventsPath, 'utf8') : '',
    async stop() {
      await cli.stop('SIGTERM', 3000)
    }
  }
}

// The failure lands in three places: the human block, the contract and the
// events timeline (a one second poll).
async function waitForLaunchFailure(session: Session, timeoutMs = 60_000) {
  await session.cli.waitFor(
    () =>
      typeof session.ready()?.browserLaunchFailedAt === 'string' &&
      session.events().includes('"browser_launch_failed"') &&
      /couldn't start/.test(session.output()),
    timeoutMs,
    'the launch failure on the contract, the timeline and the terminal'
  )

  // The last line of the block: a ready line would have come before it. A
  // value the user set ends the session instead of keeping it watching.
  await session.cli.waitFor(
    () =>
      /The dev server keeps watching|The dev session ends here/.test(
        session.output()
      ),
    timeoutMs,
    'the end of the failure block'
  )
}

// Either way the system treats the file, the contract ends on an error that
// names the pin.
async function waitForPinnedVerdict(session: Session, timeoutMs = 60_000) {
  await session.cli.waitFor(
    () =>
      session.ready()?.status === 'error' &&
      /may not be a browser/i.test(String(session.ready()?.message)) &&
      /may not be a browser/i.test(session.output()),
    timeoutMs,
    'the pinned binary named on the contract and the terminal'
  )
}

async function runWaiter(projectDir: string, browser: string) {
  return runCli([
    'dev',
    projectDir,
    '--browser',
    browser,
    '--wait',
    '--output',
    'json',
    '--wait-timeout',
    '15000'
  ])
}

// On Windows each version read of a pinned binary starts PowerShell, which
// takes about 17 seconds on the hosted runner, so these rows wait there.
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
      const binary = plantUnspawnable(join(work, 'bin'), 'chrome')

      session = startDev(projectDir, 'chrome', ['--chromium-binary', binary])
      await waitForLaunchFailure(session)

      const output = session.output()
      expect(output, output).toMatch(/Launch Probe compiled in \d+ ms/)
      expect(output, output).toMatch(
        /Chrome couldn't start, so the extension isn't running/
      )

      expect(output, output).toContain(unspawnableErrno(binary))
      expect(output, output).toMatch(/The dev server keeps watching/)
      expect(output, output).not.toMatch(/ready for development/)
      expect(output, output).not.toMatch(/Uncaught exception/)

      const ready = session.ready()
      expect(ready, output).not.toBeNull()
      expect(ready?.status).toBe('error')
      expect(ready?.code).toBe('browser_launch_failed')
      expect(String(ready?.message)).toMatch(/could not start/)
      expect(String(ready?.message)).toContain(unspawnableErrno(binary))
      expect(String(ready?.message)).toMatch(/nothing is running/)
      expect(typeof ready?.browserLaunchFailedAt).toBe('string')
      expect(String(ready?.browserLaunchFailedReason)).toContain(binary)
      expect(ready?.browserPid).toBeUndefined()

      const events = session.events()
      expect(events, events).toMatch(/"type":"browser_launch_failed"/)
      expect(events, events).toMatch(
        new RegExp(`"reason":"[^"]*\\(spawn ${unspawnableErrno(binary)}\\)`)
      )

      // The second process a consumer runs: it must not be told the session
      // is up while nothing can load.
      const waiter = await runWaiter(projectDir, 'chrome')
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
      expect(error.message).toContain(unspawnableErrno(binary))
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
      expect(output, output).toMatch(/The dev session ends here/)
      expect(output, output).not.toMatch(/The dev server keeps watching/)
      expect(output, output).not.toMatch(/ready for development/)

      const ready = session.ready()
      expect(ready?.status).toBe('error')
      expect(ready?.code).toBe('browser_launch_failed')
      expect(String(ready?.message)).toContain(missing)
      // The human frame's glyph and line breaks stay out of the contract.
      expect(String(ready?.message)).not.toMatch(/\n|⏵/)
      expect(ready?.browserLaunchFailedCode).toBe('E_BROWSER_BINARY_INVALID')
      expect(session.events(), session.events()).toMatch(
        /"type":"browser_launch_failed"/
      )

      // A path the user typed is a usage error to --wait as well.
      const waiter = await runWaiter(projectDir, 'chrome')
      expect(waiter.status, waiter.stderr).toBe(1)
      const lines = waiter.stdout.split('\n').filter((line) => line.trim())
      expect(lines, waiter.stdout).toHaveLength(1)
      expect(JSON.parse(lines[0])).toMatchObject({
        ok: false,
        command: 'dev',
        status: 'usage',
        error: {code: 'E_BROWSER_BINARY_INVALID'}
      })
    }, 120_000)

    // Text with the permission bits of a program: macOS refuses to spawn it
    // (ENOEXEC), Linux hands it to sh, and Windows refuses a .exe of text.
    const plantText = (dir: string) => {
      const binary = join(
        dir,
        process.platform === 'win32' ? 'fake-browser.exe' : 'fake-browser'
      )
      mkdirSync(dir, {recursive: true})
      writeFileSync(binary, 'not a browser\n')
      chmodSync(binary, 0o755)

      return binary
    }

    const plantLeavesWithError = (dir: string) =>
      plantBrowserStandIn(dir, 'fake-browser', {exitCode: 1})

    it.each([
      ['chrome', '--chromium-binary', plantText],
      ['firefox', '--gecko-binary', plantLeavesWithError]
    ])(
      'names the file and the flag when a pinned %s binary is no browser',
      async (browser, flag, plant) => {
        const {work, projectDir} = makeWorkspace()
        const binary = plant(join(work, 'bin'))

        session = startDev(projectDir, browser, [flag, binary])
        await waitForPinnedVerdict(session)

        const output = session.output()
        expect(output, output).toContain(binary)
        expect(output, output).toContain(flag)
        expect(output, output).not.toMatch(/ready for development/)
        expect(output, output).not.toMatch(/Uncaught exception/)

        const ready = session.ready()
        expect(String(ready?.code)).toMatch(/^browser_(launch_failed|exited)$/)
        expect(String(ready?.message)).toContain(binary)
        expect(String(ready?.message)).toContain(flag)
        expect(String(ready?.message)).not.toMatch(/\n|⏵/)
        // A file that would not run is no bad value: the launch class stands.
        expect(ready?.browserLaunchFailedCode).toBeUndefined()

        const waiter = await runWaiter(projectDir, browser)
        expect(waiter.status, waiter.stderr).toBe(1)
        const lines = waiter.stdout.split('\n').filter((line) => line.trim())
        expect(lines, waiter.stdout).toHaveLength(1)
        const frame = JSON.parse(lines[0]) as {
          ok: boolean
          error: {code: string; message: string}
        }
        expect(frame.ok).toBe(false)
        // A second process reads a browser that ran and left as an exit.
        expect(frame.error.code).toBe(
          ready?.code === 'browser_exited'
            ? 'E_BROWSER_EXITED'
            : 'E_BROWSER_LAUNCH'
        )

        expect(frame.error.message).toContain(binary)
        expect(frame.error.message).toContain(flag)
        expect(frame.error.message).toMatch(/may not be a browser/)
      },
      120_000
    )

    it('reports the firefox spawn refusal the same way', async () => {
      const {work, projectDir} = makeWorkspace()
      const binary = plantUnspawnable(join(work, 'bin'), 'firefox')

      session = startDev(projectDir, 'firefox', ['--gecko-binary', binary])
      await waitForLaunchFailure(session)

      const output = session.output()
      expect(output, output).toMatch(
        /Firefox couldn't start, so the extension isn't running/
      )

      expect(output, output).toContain(unspawnableErrno(binary))
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
