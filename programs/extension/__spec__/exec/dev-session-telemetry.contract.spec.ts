import {spawn} from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
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
  const projectDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'extjs-session-telemetry-'))
  )
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

// The local audit log is written before any send, so it holds every row the
// run produced, including one the process died too soon to deliver.
function auditRows(configHome: string): CaptureEvent[] {
  const file = join(configHome, 'extensionjs', 'telemetry', 'events.jsonl')
  if (!existsSync(file)) return []

  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CaptureEvent)
}

function runToExit(
  args: string[],
  env: Record<string, string>
): Promise<{status: number | null; stdout: string; stderr: string}> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [cliBin(), ...args], {
      cwd: cliRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {...process.env, ...env}
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
    child.on('close', (status) => done({status, stdout, stderr}))
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
          XDG_CACHE_HOME: configHome,
          npm_config_user_agent: 'pnpm/10.28.0 npm/? node/v23.8.0 darwin arm64'
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
    // The ready row is the later of the two, so both are in once it lands.
    await waitFor(
      () => server.events.some((event) => event.properties.session === 'ready'),
      15_000,
      'the dev session events'
    )

    expect(closed).toBe(false)

    const started = server.events.filter(
      (event) =>
        event.properties.command === 'dev' &&
        event.properties.session === 'started'
    )
    expect(started).toHaveLength(1)
    expect(started[0].event).toBe('command_executed')
    expect(started[0].properties.success).toBe(true)
    expect(started[0].properties.session).toBe('started')
    expect(typeof started[0].properties.is_source_build).toBe('boolean')
    expect(typeof started[0].properties.is_ci).toBe('boolean')
    expect(started[0].properties.package_manager).toBe('pnpm')

    // No browser is launched here, so ready is the first clean compile.
    const ready = server.events.filter(
      (event) => event.properties.session === 'ready'
    )
    expect(ready).toHaveLength(1)
    expect(ready[0].event).toBe('command_executed')
    expect(ready[0].properties.command).toBe('dev')
    expect(ready[0].properties.success).toBe(true)
    expect(Object.keys(ready[0].properties).sort()).toEqual(
      Object.keys(started[0].properties).sort()
    )

    child.kill('SIGINT')
    await waitFor(() => closed, 20_000, 'the dev session to end').catch(() => {
      // The exit path belongs to the dev server and the browser handlers. This
      // spec is about the row, not about who ends the process.
    })

    // A Ctrl-C is not a failure, and neither row is counted twice.
    const devEvents = server.events.filter(
      (event) => event.properties.command === 'dev'
    )
    expect(devEvents.map((event) => event.properties.session)).toEqual([
      'started',
      'ready'
    ])

    expect(
      server.events.filter((event) => event.event === 'command_failed')
    ).toEqual([])
  }, 150_000)

  it('reports a session that died on a throwing config, in both outputs', async () => {
    const server = await startCaptureServer()
    cleanups.push(server.close)

    const projectDir = createFixture()
    cleanups.push(() => rmSync(projectDir, {recursive: true, force: true}))
    writeFileSync(
      join(projectDir, 'extension.config.js'),
      "throw new Error('config exploded on purpose')\n"
    )

    // What develop prints for this failure, pinned so reporting it can never
    // add a line, repeat one or print a stack.
    const printed =
      '⏵⏵⏵ Dev mode failed.\n' +
      "Couldn't load extension.config.js.\n" +
      `PATH ${join(projectDir, 'extension.config.js')}\n` +
      'config exploded on purpose\n' +
      'Fix the config file, then run the command again.\n'

    for (const output of ['pretty', 'json'] as const) {
      const configHome = mkdtempSync(join(tmpdir(), 'extjs-session-config-'))
      cleanups.push(() => rmSync(configHome, {recursive: true, force: true}))
      server.events.length = 0

      const run = await runToExit(
        [
          'dev',
          projectDir,
          '--no-browser',
          '--browser=chromium',
          ...(output === 'json' ? ['--output', 'json'] : [])
        ],
        {
          NO_COLOR: '1',
          // Node 22.12 warns on stderr when CommonJS loads an ES module; that
          // line is Node's, not ours, and stderr is compared whole below.
          NODE_NO_WARNINGS: '1',
          EXTENSION_ENV: 'test',
          POSTHOG_HOST: `http://127.0.0.1:${server.port}`,
          EXTENSION_TELEMETRY: '1',
          // Inherited, it turns develop's exit into a rejection and the run
          // would take the top-level handler instead of the path under test.
          VITEST: '',
          XDG_CONFIG_HOME: configHome,
          XDG_CACHE_HOME: configHome
        }
      )

      expect(run.status).toBe(1)
      expect(run.stderr).toBe(printed)

      if (output === 'pretty') {
        expect(run.stdout).toBe('')
      } else {
        const frame = JSON.parse(run.stdout) as {
          status: string
          error: {code: string}
        }
        expect(frame.status).toBe('failed')
        expect(frame.error.code).toBe('E_CONFIG_LOAD')
      }

      // Two rows of the three a process may send: the start, then the death.
      const rows = auditRows(configHome).map((row) => ({
        event: row.event,
        command: row.properties.command,
        session: row.properties.session,
        code: row.properties.code,
        exit_code: row.properties.exit_code
      }))
      expect(rows).toEqual([
        {
          event: 'command_executed',
          command: 'dev',
          session: 'started',
          code: undefined,
          exit_code: undefined
        },
        {
          event: 'command_failed',
          command: 'dev',
          session: undefined,
          code: 'E_CONFIG_LOAD',
          exit_code: 1
        }
      ])

      // The failure row is sent before the exit, not left in the queue.
      const delivered = server.events.filter(
        (event) => event.event === 'command_failed'
      )
      expect(delivered).toHaveLength(1)
      expect(delivered[0].properties).toMatchObject({
        command: 'dev',
        success: false,
        code: 'E_CONFIG_LOAD',
        exit_code: 1
      })
    }
  }, 60_000)
})
