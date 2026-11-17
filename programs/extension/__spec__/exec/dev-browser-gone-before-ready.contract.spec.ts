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
import {startCli} from '../helpers/run-cli'

// A managed Chrome whose binary is a script that exits at once: the shape of
// a browser that dies at launch, with nothing on screen and no download.
function plantExitingChrome(cacheRoot: string) {
  const build = join(cacheRoot, 'chrome', 'chrome', 'mac_arm-151.0.7922.71')
  const dir =
    process.platform === 'darwin'
      ? join(
          build,
          'chrome-mac-arm64',
          'Google Chrome for Testing.app',
          'Contents',
          'MacOS'
        )
      : join(
          cacheRoot,
          'chrome',
          'chrome',
          'linux-151.0.7922.71',
          'chrome-linux64'
        )
  const binary = join(
    dir,
    process.platform === 'darwin' ? 'Google Chrome for Testing' : 'chrome'
  )
  mkdirSync(dir, {recursive: true})
  writeFileSync(binary, '#!/bin/sh\nexit 0\n')
  chmodSync(binary, 0o755)
}

function writeProject(dir: string) {
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Gone Probe',
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

// The only browser this run can find is the stand-in planted in its cache:
// the helper turns the system scan off and the home is a temp folder.
async function runDevUntilBrowserGone(projectDir: string, cacheRoot: string) {
  const session = startCli(['dev', projectDir, '--browser', 'chrome'], {
    env: {EXT_BROWSERS_CACHE_DIR: cacheRoot}
  })
  const sessionDir = join(projectDir, 'dist', 'extension-js', 'chrome')
  const readyPath = join(sessionDir, 'ready.json')
  const eventsPath = join(sessionDir, 'events.ndjson')
  const events = () =>
    existsSync(eventsPath) ? readFileSync(eventsPath, 'utf8') : ''

  let ready: Record<string, unknown> | null = null
  let timeline = ''

  try {
    // The exit lands in three places: the human line, the contract and the
    // events timeline (a one second poll).
    await session.waitFor(
      () =>
        typeof readJson(readyPath)?.browserExitedAt === 'string' &&
        events().includes('"browser_exited"') &&
        /nothing is running|ready for development/.test(session.read().output),
      60_000,
      'the browser exit on the contract, the timeline and the terminal'
    )

    // Read before the stop, which rewrites the contract as stopped.
    ready = readJson(readyPath)
    timeline = events()
  } finally {
    // A ready line, were one printed, follows the gone line by less than a
    // tick, so the transcript is read once the CLI has ended.
    await session.stop('SIGTERM', 3000)
  }

  return {output: session.read().output, ready, events: timeline}
}

// The stand-in binary is a shell script, which Windows cannot exec, so the
// contract runs on posix only. The launcher's gone handling is platform-neutral.
describe.skipIf(process.platform === 'win32')(
  'dev with a managed browser that exits at launch',
  () => {
    const leftovers: string[] = []

    afterEach(() => {
      for (const dir of leftovers.splice(0)) {
        rmSync(dir, {recursive: true, force: true})
      }
    })

    it('reports the browser gone, never ready, and writes the contract to match', async () => {
      const work = mkdtempSync(join(tmpdir(), 'extjs-gone-before-ready-'))
      leftovers.push(work)
      const projectDir = join(work, 'project')
      const cacheRoot = join(work, 'cache')
      mkdirSync(projectDir, {recursive: true})
      writeProject(projectDir)
      plantExitingChrome(cacheRoot)

      const {output, ready, events} = await runDevUntilBrowserGone(
        projectDir,
        cacheRoot
      )

      expect(output, output).toMatch(/Gone Probe compiled in \d+ ms/)
      expect(output, output).toMatch(/closed cleanly \(exit code 0\)/)
      expect(output, output).not.toMatch(/Uncaught exception/)
      expect(output, output).not.toMatch(/ready for development/)
      expect(output, output).toMatch(
        /Chrome exited before the extension loaded, so nothing is running/
      )

      expect(output, output).toMatch(/The dev server keeps watching/)

      expect(ready, output).not.toBeNull()
      expect(ready?.status).toBe('error')
      expect(ready?.code).toBe('browser_exited')
      expect(typeof ready?.browserExitedAt).toBe('string')
      expect(ready?.browserExitCode).toBe(0)
      expect(String(ready?.message)).toMatch(/before the extension loaded/)
      expect(events, events).toMatch(/"type":"browser_exited"/)
    }, 90_000)
  }
)
