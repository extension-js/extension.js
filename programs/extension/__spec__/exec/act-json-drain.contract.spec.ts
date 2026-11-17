import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {createServer, type Server} from 'node:http'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {WebSocketServer} from 'ws'
import {runCli as spawnCli} from '../helpers/run-cli'

// Big enough that the frame cannot fit in one pipe buffer (64KB on macOS
// sockets): a pre-drain exit truncates it, the drained exit must not (#79).
const VALUE_BYTES = 256 * 1024

interface CliRun {
  code: number | null
  stdout: string
  stderr: string
}

async function runCli(args: string[]): Promise<CliRun> {
  const run = await spawnCli(args, {timeoutMs: 30_000})

  return {code: run.status, stdout: run.stdout, stderr: run.stderr}
}

let server: Server
let wss: WebSocketServer
let controlPort: number
let projectDir: string

beforeAll(async () => {
  server = createServer()
  wss = new WebSocketServer({server, path: '/extjs-control'})

  wss.on('connection', (socket) => {
    socket.on('message', (data) => {
      let frame: {type?: string; cmdId?: string}

      try {
        frame = JSON.parse(data.toString())
      } catch {
        return
      }

      if (frame.type === 'hello') {
        socket.send(JSON.stringify({type: 'ready', v: 1, capabilities: {}}))

        return
      }

      if (frame.type === 'command') {
        socket.send(
          JSON.stringify({
            type: 'result',
            cmdId: frame.cmdId,
            ok: true,
            value: 'x'.repeat(VALUE_BYTES)
          })
        )
      }
    })
  })

  await new Promise<void>((resolvePromise) =>
    server.listen(0, '127.0.0.1', resolvePromise)
  )

  const address = server.address()
  controlPort = typeof address === 'object' && address ? address.port : 0

  projectDir = mkdtempSync(join(tmpdir(), 'extjs-act-drain-'))
  const readyDir = join(projectDir, 'dist', 'extension-js', 'chromium')
  mkdirSync(readyDir, {recursive: true})
  writeFileSync(
    join(readyDir, 'ready.json'),
    JSON.stringify({
      status: 'ready',
      controlPort,
      instanceId: 'inst-drain',
      runId: 'run-drain'
    })
  )
})

afterAll(async () => {
  wss.close()
  await new Promise<void>((resolvePromise) =>
    server.close(() => resolvePromise())
  )

  rmSync(projectDir, {recursive: true, force: true})
})

describe('act --output json stdout drain contract (#79)', () => {
  it('delivers a frame larger than one pipe buffer intact before exiting', async () => {
    const result = await runCli(['reload', projectDir, '--output', 'json'])

    expect(result.code).toBe(0)
    expect(result.stdout.length).toBeGreaterThan(VALUE_BYTES)

    // The MCP does exactly this: JSON.parse(stdout.trim()) over one document.
    const frame = JSON.parse(result.stdout.trim())
    expect(frame.ok).toBe(true)
    expect(frame.value).toHaveLength(VALUE_BYTES)

    // The same stdout is now a schema-1 envelope, added around the act frame
    // rather than replacing it.
    expect(frame.schema).toBe(1)
    expect(frame.command).toBe('reload')
    expect(frame.status).toBe('ok')
    expect(frame.error).toBeNull()
    expect(frame.warnings).toEqual([])
  }, 40000)

  it('emits one parseable failure envelope when no session is up', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'extjs-act-nosession-'))

    try {
      const result = await runCli(['reload', empty, '--output', 'json'])

      expect(result.code).toBe(1)
      const frame = JSON.parse(result.stdout.trim())
      expect(frame).toMatchObject({
        schema: 1,
        ok: false,
        command: 'reload',
        status: 'not-found',
        value: null,
        warnings: []
      })

      expect(frame.error.code).toBe('E_SESSION_NOT_FOUND')
      // The human copy stays on stderr, and the MCP still matches it.
      expect(result.stderr).toContain('No active control channel')
    } finally {
      rmSync(empty, {recursive: true, force: true})
    }
  }, 40000)
})

// Lives beside the act contract because it is the same guarantee: whatever a
// terminating CLI frame is, stdout carries it whole and carries nothing else.
describe('logs terminating frames (D7)', () => {
  let empty: string

  beforeAll(() => {
    empty = mkdtempSync(join(tmpdir(), 'extjs-logs-frame-'))
  })

  afterAll(() => {
    rmSync(empty, {recursive: true, force: true})
  })

  it('emits a not-found envelope when the log file is missing', async () => {
    const result = await runCli(['logs', empty, '--output', 'ndjson'])

    expect(result.code).toBe(1)
    const frame = JSON.parse(result.stdout.trim())
    expect(frame).toMatchObject({
      schema: 1,
      ok: false,
      command: 'logs',
      status: 'not-found',
      value: null,
      warnings: []
    })

    expect(frame.error.code).toBe('E_LOGS_NOT_FOUND')
    expect(result.stderr).toContain('No logs found at')
  }, 40000)

  it('emits a not-found envelope when --follow has no session', async () => {
    const result = await runCli([
      'logs',
      empty,
      '--follow',
      '--output',
      'ndjson'
    ])

    expect(result.code).toBe(1)
    const frame = JSON.parse(result.stdout.trim())
    expect(frame.command).toBe('logs')
    expect(frame.error.code).toBe('E_SESSION_NOT_FOUND')
    expect(result.stderr).toContain('No active dev session control channel')
  }, 40000)

  it('leaves stdout empty on the pretty path', async () => {
    const result = await runCli(['logs', empty, '--output', 'pretty'])

    expect(result.code).toBe(1)
    expect(result.stdout.trim()).toBe('')
    expect(result.stderr).toContain('No logs found at')
  }, 40000)

  it('keeps log records raw, never wrapped in an envelope', async () => {
    const withLogs = mkdtempSync(join(tmpdir(), 'extjs-logs-records-'))

    try {
      const dir = join(withLogs, 'dist', 'extension-js', 'chromium')
      mkdirSync(dir, {recursive: true})
      const records = [
        {
          v: 1,
          seq: 1,
          level: 'log',
          context: 'background',
          messageParts: ['a']
        },
        {v: 1, seq: 2, level: 'warn', context: 'content', messageParts: ['b']}
      ]
      writeFileSync(
        join(dir, 'logs.ndjson'),
        `${records.map((r) => JSON.stringify(r)).join('\n')}\n`
      )

      const result = await runCli(['logs', withLogs, '--output', 'ndjson'])

      expect(result.code).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines).toHaveLength(records.length)
      // D7: a record is a record. No schema, no envelope wrapper.
      expect(lines.map((line) => JSON.parse(line))).toEqual(records)
    } finally {
      rmSync(withLogs, {recursive: true, force: true})
    }
  }, 40000)
})
