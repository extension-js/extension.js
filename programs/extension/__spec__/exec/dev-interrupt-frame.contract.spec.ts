import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import http from 'node:http'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {everyLineAsFrame, freshCliHome, startCli} from '../helpers/run-cli'

interface Frame {
  ok: boolean
  command: string
  status: string
  value: {signal?: string} | null
  error: {code: string; message: string} | null
}

function parseFrames(stdout: string): Frame[] {
  return everyLineAsFrame<Frame>(stdout)
}

function createProject(leftovers: string[]): string {
  const work = mkdtempSync(join(tmpdir(), 'extjs-interrupt-frame-'))
  leftovers.push(work)
  const projectDir = join(work, 'project')
  mkdirSync(projectDir, {recursive: true})
  writeFileSync(
    join(projectDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Interrupt Probe',
      version: '1.0.0'
    })
  )

  return projectDir
}

// Posix only: on Windows a kill ends the child before any handler runs.
describe.skipIf(process.platform === 'win32')(
  'a dev session told to stop ends its json stream with one coded frame',
  () => {
    const leftovers: string[] = []

    afterEach(() => {
      for (const dir of leftovers.splice(0)) {
        rmSync(dir, {recursive: true, force: true})
      }
    })

    it.each([
      'SIGINT',
      'SIGTERM'
    ] as const)('%s is the last frame, as stopped with E_INTERRUPTED, and the run exits 0', async (signal) => {
      const projectDir = createProject(leftovers)
      const session = startCli([
        'dev',
        projectDir,
        '--browser',
        'chrome',
        '--no-browser',
        '--output',
        'json'
      ])

      await session.waitFor(
        () => session.frames<Frame>().some((frame) => frame.status === 'ready'),
        60_000,
        'the ready frame'
      )

      const exit = await session.stop(signal, 15_000)
      const {stdout, stderr} = session.read()

      expect(exit, stderr).toEqual({status: 0, signal: null})

      const frames = parseFrames(stdout)
      const last = frames[frames.length - 1]
      expect(last).toMatchObject({
        ok: false,
        command: 'dev',
        status: 'stopped',
        error: {code: 'E_INTERRUPTED'}
      })

      expect(last.error?.message).toContain(signal)
      expect(last.value?.signal).toBe(signal)
      expect(frames.filter((frame) => frame.status === 'stopped')).toHaveLength(
        1
      )

      const ready = JSON.parse(
        readFileSync(
          join(projectDir, 'dist', 'extension-js', 'chrome', 'ready.json'),
          'utf8'
        )
      ) as {status: string; code: string}
      expect(ready.status).toBe('stopped')
      expect(ready.code).toBe('shutdown')

      const shutdownRows = readFileSync(
        join(projectDir, 'dist', 'extension-js', 'chrome', 'events.ndjson'),
        'utf8'
      )
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as {type: string})
        .filter((row) => row.type === 'shutdown')
      expect(shutdownRows).toHaveLength(1)
    }, 90_000)

    // A shell reads 130 as "ended by Ctrl+C". The CLI answers 0 today, in
    // text mode too, and this pins that until the exit code is decided.
    it('exits 0, not 130, on SIGINT in text mode and says nothing more', async () => {
      const projectDir = createProject(leftovers)
      const session = startCli([
        'dev',
        projectDir,
        '--browser',
        'chrome',
        '--no-browser'
      ])

      await session.waitFor(
        () => session.read().stdout.includes('Watching for file changes.'),
        60_000,
        'the ready line'
      )

      const before = session.read().output
      const exit = await session.stop('SIGINT', 15_000)

      expect(exit, session.read().output).toEqual({status: 0, signal: null})
      expect(session.read().output.slice(before.length)).toBe('')
    }, 90_000)
  }
)

function listen(handler: http.RequestListener): Promise<{
  url: string
  close: () => Promise<void>
}> {
  const server = http.createServer(handler)

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0

      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections()
            server.close(() => done())
          })
      })
    })
  })
}

// A --wait run that never saw a session exits 130 or 143.
// Posix only: on Windows a kill ends the child before any handler runs.
describe.skipIf(process.platform === 'win32')(
  'a dev --wait run told to stop before any session came up',
  () => {
    const leftovers: string[] = []
    const closers: Array<() => Promise<void>> = []

    afterEach(async () => {
      for (const close of closers.splice(0)) await close()

      for (const dir of leftovers.splice(0)) {
        rmSync(dir, {recursive: true, force: true})
      }
    })

    async function interruptWait(
      signal: 'SIGINT' | 'SIGTERM',
      telemetry: boolean
    ) {
      let asked = 0
      // The update check runs after the signal handlers are installed, so its
      // request is the first sign the CLI can answer a signal its own way.
      const registry = await listen((_request, response) => {
        asked++
        response.writeHead(200, {'content-type': 'application/json'})
        response.end(JSON.stringify({'dist-tags': {latest: '0.0.1'}}))
      })
      const collector = await listen((request, response) => {
        request.resume()
        request.on('end', () => response.end('{"status":1}'))
      })

      closers.push(registry.close, collector.close)

      // A home and temp folder of its own: a cached update answer asks nothing.
      const home = freshCliHome()

      const session = startCli(
        [
          'dev',
          createProject(leftovers),
          '--wait',
          '--wait-timeout',
          '60000',
          '--output',
          'json'
        ],
        {
          telemetry,
          home,
          env: {
            npm_registry: registry.url,
            POSTHOG_HOST: collector.url.slice(0, -1),
            EXTENSION_TELEMETRY: telemetry ? '1' : '0',
            EXTENSION_TELEMETRY_TIMEOUT_MS: '5000'
          }
        }
      )

      await session.waitFor(() => asked > 0, 30_000, 'the update check')

      const exit = await session.stop(signal, 15_000)
      const audit = join(
        home.configHome,
        'extensionjs',
        'telemetry',
        'events.jsonl'
      )
      const rows = existsSync(audit)
        ? readFileSync(audit, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map(
              (line) =>
                JSON.parse(line) as {
                  event: string
                  properties: Record<string, unknown>
                }
            )
            .map((row) => ({
              event: row.event,
              command: row.properties.command,
              code: row.properties.code,
              exit_code: row.properties.exit_code
            }))
        : []

      return {exit, rows, ...session.read()}
    }

    it.each([
      ['SIGINT', 130],
      ['SIGTERM', 143]
    ] as const)(
      'exits %s as %i with telemetry on, and prints no frame',
      async (signal, status) => {
        const run = await interruptWait(signal, true)

        expect(run.exit).toEqual({status, signal: null})
        // Pins today's behavior: under --output json nothing says it ended.
        expect({stdout: run.stdout, stderr: run.stderr}).toEqual({
          stdout: '',
          stderr: ''
        })

        expect(run.rows).toEqual([
          {
            event: 'command_failed',
            command: 'dev',
            code: 'E_INTERRUPTED',
            exit_code: status
          }
        ])
      },
      60_000
    )

    // Pins today's behavior: with telemetry off no handler is installed, so
    // the run dies of the signal and a parent sees no exit code at all.
    it('dies of SIGTERM with telemetry off', async () => {
      const run = await interruptWait('SIGTERM', false)

      expect(run.exit).toEqual({status: null, signal: 'SIGTERM'})
      expect({stdout: run.stdout, stderr: run.stderr, rows: run.rows}).toEqual({
        stdout: '',
        stderr: '',
        rows: []
      })
    }, 60_000)
  }
)
