import {spawn} from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import http from 'node:http'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, describe, expect, it} from 'vitest'

// `dev` never resolves `parseAsync` and dies from a signal, which Node answers
// with no `beforeExit`, so a successful session used to report nothing at all.
// This spawns the real CLI, waits for the session to come up, and reads the
// collector while the process is still running.

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const cliRoot = resolve(__dirname, '../..')

interface CaptureEvent {
  event: string
  properties: Record<string, unknown>
  distinct_id: string
}

function cliBin(): string {
  const cjs = join(cliRoot, 'dist', 'cli.cjs')
  if (existsSync(cjs)) return cjs
  return join(cliRoot, 'dist', 'cli.js')
}

function createFixture(): string {
  const projectDir = mkdtempSync(join(tmpdir(), 'extjs-session-telemetry-'))
  mkdirSync(join(projectDir, 'content'), {recursive: true})
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({name: 'session-telemetry', private: true, version: '1.0.0'})
  )
  writeFileSync(
    join(projectDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Session Telemetry',
      version: '1.0.0',
      content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
    })
  )
  writeFileSync(
    join(projectDir, 'content', 'scripts.js'),
    "console.log('session telemetry fixture')\n"
  )
  return projectDir
}

function startCaptureServer(): Promise<{
  port: number
  events: CaptureEvent[]
  close: () => Promise<void>
}> {
  const events: CaptureEvent[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      if (req.url === '/capture/') {
        try {
          const parsed = JSON.parse(body) as {batch?: CaptureEvent[]}
          for (const event of parsed.batch ?? []) events.push(event)
        } catch {
          // Ignore
        }
      }
      res.writeHead(200, {'content-type': 'application/json'})
      res.end('{"status":1}')
    })
  })
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      done({
        port,
        events,
        close: () =>
          new Promise<void>((closed) => {
            server.close(() => closed())
          })
      })
    })
  })
}

function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  label: string
): Promise<void> {
  const started = Date.now()
  return new Promise((done, fail) => {
    const tick = () => {
      if (predicate()) return done()
      if (Date.now() - started > timeoutMs) {
        return fail(new Error(`timed out waiting for ${label}`))
      }
      setTimeout(tick, 100)
    }
    tick()
  })
}

describe('a dev session reports itself while it is still running', () => {
  const cleanups: Array<() => Promise<void> | void> = []

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup()
  })

  it('sends command_executed at session start and survives a Ctrl-C', async () => {
    const server = await startCaptureServer()
    cleanups.push(server.close)

    const projectDir = createFixture()
    cleanups.push(() => rmSync(projectDir, {recursive: true, force: true}))

    const configHome = mkdtempSync(join(tmpdir(), 'extjs-session-config-'))
    cleanups.push(() => rmSync(configHome, {recursive: true, force: true}))

    let output = ''
    let closed = false
    const child = spawn(
      process.execPath,
      [cliBin(), 'dev', projectDir, '--no-browser', '--browser=chromium'],
      {
        cwd: cliRoot,
        stdio: 'pipe',
        env: {
          ...process.env,
          NO_COLOR: '1',
          EXTENSION_ENV: 'test',
          POSTHOG_HOST: `http://127.0.0.1:${server.port}`,
          EXTENSION_TELEMETRY: '1',
          EXTENSION_TELEMETRY_TIMEOUT_MS: '5000',
          // Zero, so an event that arrives proves the session row is never up
          // for sampling: the failure rate needs a matching denominator.
          EXTENSION_TELEMETRY_SAMPLE_RATE: '0',
          XDG_CONFIG_HOME: configHome,
          XDG_CACHE_HOME: configHome
        }
      }
    )
    cleanups.push(() => {
      if (!closed) child.kill('SIGKILL')
    })

    child.stdout.on('data', (chunk) => (output += chunk.toString()))
    child.stderr.on('data', (chunk) => (output += chunk.toString()))
    child.on('close', () => {
      closed = true
    })

    await waitFor(
      () => output.includes('Watching for file changes.'),
      90_000,
      `the dev session to come up, output so far:\n${output}`
    )

    // Still running: nothing here waited for an exit, which is the whole point.
    await waitFor(
      () => server.events.some((event) => event.properties.command === 'dev'),
      15_000,
      'the dev session event'
    )
    expect(closed).toBe(false)

    const started = server.events.filter(
      (event) => event.properties.command === 'dev'
    )
    expect(started).toHaveLength(1)
    expect(started[0].event).toBe('command_executed')
    expect(started[0].properties.success).toBe(true)
    expect(started[0].properties.session).toBe('started')
    expect(typeof started[0].properties.is_source_build).toBe('boolean')
    expect(typeof started[0].properties.is_ci).toBe('boolean')

    child.kill('SIGINT')
    await waitFor(() => closed, 20_000, 'the dev session to end').catch(() => {
      // The exit path belongs to the dev server and the browser handlers. This
      // spec is about the row, not about who ends the process.
    })

    // A Ctrl-C is not a failure, and the session is not counted twice.
    const devEvents = server.events.filter(
      (event) => event.properties.command === 'dev'
    )
    expect(devEvents).toHaveLength(1)
    expect(
      server.events.filter((event) => event.event === 'command_failed')
    ).toEqual([])
  }, 150_000)
})
