import {spawn} from 'node:child_process'
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

function stripVitestEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
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

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function runDevUntilBrowserGone(projectDir: string, cacheRoot: string) {
  const child = spawn(
    process.execPath,
    [cliBin, 'dev', projectDir, '--browser', 'chrome'],
    {
      cwd: cliRoot,
      stdio: 'pipe',
      env: stripVitestEnv({EXT_BROWSERS_CACHE_DIR: cacheRoot})
    }
  )
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk.toString()))
  child.stderr.on('data', (chunk) => (output += chunk.toString()))

  const readyPath = join(
    projectDir,
    'dist',
    'extension-js',
    'chrome',
    'ready.json'
  )
  const eventsPath = join(
    projectDir,
    'dist',
    'extension-js',
    'chrome',
    'events.ndjson'
  )
  const deadline = Date.now() + 60_000

  try {
    // The exit lands in three places: the human line, the contract and the
    // events timeline (a one second poll). Wait for all three or give up.
    while (Date.now() < deadline) {
      const ready = readJson(readyPath)
      const events = existsSync(eventsPath)
        ? readFileSync(eventsPath, 'utf8')
        : ''

      if (
        typeof ready?.browserExitedAt === 'string' &&
        events.includes('"browser_exited"') &&
        /nothing is running|ready for development/.test(output)
      ) {
        break
      }

      await sleep(250)
    }

    // The ready line, when it is printed, follows the gone line by less than
    // a tick, so give the transcript a moment to settle before reading it.
    await sleep(1000)

    return {
      output: output.replace(ANSI, ''),
      ready: readJson(readyPath),
      events: existsSync(eventsPath) ? readFileSync(eventsPath, 'utf8') : ''
    }
  } finally {
    child.kill('SIGTERM')
    await Promise.race([
      new Promise((resolvePromise) => child.once('close', resolvePromise)),
      sleep(3000).then(() => child.kill('SIGKILL'))
    ])
  }
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
