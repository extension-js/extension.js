import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {WebSocket} from 'ws'
import {BridgeBroker} from '../../develop/dev-server/control-bridge/broker'
import {
  CLOSE_BAD_INSTANCE,
  CONTROL_WS_PATH,
  type IncomingLogEvent
} from '../../develop/dev-server/control-bridge/contracts'
import {LogRingBuffer} from '../../develop/dev-server/control-bridge/ring-buffer'
import {
  type ControlServer,
  startControlServer
} from '../../develop/dev-server/control-bridge/ws-control-server'
import {readyContractPath} from '../../develop/lib/session-paths'

// `--follow` over the live channel with no browser: the real bridge module,
// a real control server and broker on an ephemeral port, a producer socket
// on the wire, and a ready.json on disk where the engine writes it.
vi.mock('../helpers/extension-develop-runtime', async () => ({
  loadExtensionDevelopBridgeModule: vi.fn(
    () => import('../../develop/bridge-entry')
  )
}))

import {registerLogsCommand} from '../commands/logs'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

const INSTANCE_ID = 'inst-live'
const RUN_ID = 'run-live'
const BROWSER = 'chromium'

let dir: string
let server: ControlServer | null = null
let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>
const sockets: WebSocket[] = []

beforeEach(() => {
  stubProcessExit()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-logs-live-'))
  // A package root under the scratch dir, so the session root walk anchors
  // here and the reader looks at the same ready.json the spec writes.
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"live"}')
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    '{"manifest_version":3,"name":"live","version":"1.0"}'
  )
})

afterEach(async () => {
  for (const socket of sockets) {
    try {
      socket.terminate()
    } catch {
      // Ignore
    }
  }
  sockets.length = 0
  if (server) {
    await server.close()
    server = null
  }
  fs.rmSync(dir, {recursive: true, force: true})
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function run(argv: string[]) {
  return runCli(makeProgram(registerLogsCommand), argv)
}

function printed(): Array<Record<string, unknown>> {
  return logSpy.mock.calls.map((call) => JSON.parse(String(call[0])))
}

function errorLines(): string[] {
  return errorSpy.mock.calls.map((call) => String(call[0]))
}

function writeReady(patch: Record<string, unknown>) {
  const file = readyContractPath(dir, BROWSER)
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(
    file,
    JSON.stringify({
      schemaVersion: 2,
      schema: 1,
      status: 'ready',
      command: 'dev',
      browser: BROWSER,
      instanceId: INSTANCE_ID,
      runId: RUN_ID,
      ...patch
    })
  )
}

function incoming(
  message: string,
  extra: Partial<IncomingLogEvent> = {}
): IncomingLogEvent {
  return {
    v: 1,
    id: `id-${message}`,
    timestamp: 1788620401000,
    level: 'info',
    context: 'background',
    messageParts: [message],
    runId: 'sw-side-id',
    ...extra
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function until(check: () => boolean, label: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await sleep(20)
  }
}

function connectProducer(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${CONTROL_WS_PATH}`)
  sockets.push(ws)
  return new Promise((resolve, reject) => {
    ws.on('error', reject)
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'hello',
          v: 1,
          role: 'producer',
          instanceId: INSTANCE_ID
        })
      )
      resolve(ws)
    })
  })
}

describe('extension logs --follow over the live control channel', () => {
  it('prints producer frames and a gap, then settles when the session stops', async () => {
    // A ring of two makes the third frame drop the first, which is the only
    // way the broker emits a gap on the wire.
    const broker = new BridgeBroker({
      instanceId: INSTANCE_ID,
      runId: RUN_ID,
      engine: 'chromium',
      ring: new LogRingBuffer(2)
    })
    server = await startControlServer({broker})
    writeReady({controlPort: server.port})

    const exit = run(['logs', dir, '--follow', '--output', 'ndjson'])
    await until(() => broker.consumerCount === 1, 'the follower to attach')

    const producer = await connectProducer(server.port)
    await until(() => broker.producerCount === 1, 'the producer to attach')
    for (const event of [
      incoming('boot'),
      incoming('careful', {
        level: 'warn',
        context: 'content',
        url: 'https://example.com/page',
        tabId: 7
      }),
      incoming('third')
    ]) {
      producer.send(JSON.stringify({type: 'log', event}))
    }

    await until(() => printed().length === 3, 'three log records')
    // The broker owns the session identity: every record carries ready.json's
    // runId and a sequence number, not what the producer stamped.
    expect(printed()).toMatchObject([
      {seq: 1, level: 'info', messageParts: ['boot'], runId: RUN_ID},
      {
        seq: 2,
        level: 'warn',
        context: 'content',
        url: 'https://example.com/page',
        tabId: 7,
        runId: RUN_ID
      },
      {seq: 3, messageParts: ['third'], runId: RUN_ID}
    ])

    await until(
      () => errorLines().some((line) => line.includes('dropped')),
      'the gap notice'
    )
    expect(errorLines().find((line) => line.includes('dropped'))).toContain(
      '1 event(s) dropped (ring_overflow), stream is behind'
    )
    // The gap is stderr only, so the ndjson stream stays records + frames.
    expect(printed().every((record) => typeof record.seq === 'number')).toBe(
      true
    )

    // The engine ends a session by stamping the contract before the channel
    // goes away. The follower must notice and hand back the terminal.
    writeReady({controlPort: server.port, status: 'stopped'})
    await server.close()
    server = null

    expect(await exit).toBe(0)
    const last = printed().at(-1)
    expect(last).toMatchObject({
      ok: true,
      command: 'logs',
      status: 'closed',
      value: {follow: true, closeCode: expect.any(Number)}
    })
    expect(
      errorLines().some((line) => line.includes('the control channel closed'))
    ).toBe(true)

    // Past the first two reconnect backoffs nothing else may print: the
    // consumer is closed and no retry timer is pending.
    const logCalls = logSpy.mock.calls.length
    const errorCalls = errorSpy.mock.calls.length
    await sleep(800)
    expect(logSpy.mock.calls.length).toBe(logCalls)
    expect(errorSpy.mock.calls.length).toBe(errorCalls)
  })

  it('rides out a server restart and ends on a refused hello', async () => {
    const broker = new BridgeBroker({
      instanceId: INSTANCE_ID,
      runId: RUN_ID,
      engine: 'chromium'
    })
    server = await startControlServer({broker})
    const port = server.port
    writeReady({controlPort: port})

    let done = false
    const exit = run(['logs', dir, '--follow', '--output', 'ndjson']).then(
      (code) => {
        done = true
        return code
      }
    )
    await until(() => broker.consumerCount === 1, 'the follower to attach')

    // The channel drops while ready.json still names this session: that is
    // a blip, and the follower must come back rather than give up.
    await server.close()
    server = await startControlServer({broker, port})
    await until(() => broker.consumerCount === 1, 'the follower to reconnect')
    expect(done).toBe(false)

    broker.ingestLog(incoming('after-restart'))
    await until(
      () => printed().some((record) => record.seq === 1),
      'the record sent after the restart'
    )
    expect(printed().at(-1)).toMatchObject({
      seq: 1,
      messageParts: ['after-restart'],
      runId: RUN_ID
    })

    // Another session takes the port while the stale contract still names
    // the old one. The server refuses the hello, and a refusal is final.
    await server.close()
    server = await startControlServer({
      broker: new BridgeBroker({instanceId: 'inst-other', runId: 'run-other'}),
      port
    })

    expect(await exit).toBe(0)
    expect(printed().at(-1)).toMatchObject({
      ok: true,
      command: 'logs',
      status: 'closed',
      value: {
        follow: true,
        closeCode: CLOSE_BAD_INSTANCE,
        reason: 'instanceId mismatch'
      }
    })
  })
})
