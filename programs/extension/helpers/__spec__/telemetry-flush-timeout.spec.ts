import * as http from 'node:http'
import type {AddressInfo} from 'node:net'
import * as path from 'node:path'
import {Worker} from 'node:worker_threads'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {createTelemetryKit, Telemetry, type TelemetrySender} from '../telemetry'
import {
  readRows,
  type Sandbox,
  type SentRow,
  useTelemetrySandbox
} from './telemetry-sandbox'

const sandbox = useTelemetrySandbox()

const COLD_ROUND_TRIP_MS = 700

afterEach(() => {
  vi.useRealTimers()
})

type Attempt = {aborted: boolean; settled: 'ok' | 'aborted' | null}

// Answers after `latencyMs`, and stops early when the flush aborts it.
function slowSender(attempt: Attempt, latencyMs: number): TelemetrySender {
  return (_url, {signal}) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        attempt.settled = 'ok'
        resolve(undefined)
      }, latencyMs)

      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        attempt.aborted = true
        attempt.settled = 'aborted'
        reject(Object.assign(new Error('aborted'), {name: 'AbortError'}))
      })
    })
}

function trackCreate(box: Sandbox, init = {}) {
  const telemetry = box.telemetry(init)

  telemetry.track('command_executed', {
    command: 'create',
    success: true,
    version: '9.9.9',
    template: 'content',
    source: 'templates'
  })

  return telemetry
}

describe('the flush outlives a cold round trip', () => {
  it('does not abort a send that takes as long as a real one', async () => {
    vi.useFakeTimers()
    const attempt: Attempt = {aborted: false, settled: null}
    const box = sandbox({
      deps: {send: slowSender(attempt, COLD_ROUND_TRIP_MS)}
    })
    const flushed = trackCreate(box).flush()

    await vi.advanceTimersByTimeAsync(COLD_ROUND_TRIP_MS - 1)
    expect(attempt).toEqual({aborted: false, settled: null})

    await vi.advanceTimersByTimeAsync(1)
    await flushed

    expect(attempt).toEqual({aborted: false, settled: 'ok'})
    // The ceiling is cleared with the answer, so nothing is left to fire.
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each<[string, {timeoutMs?: number}, Record<string, string>, number]>([
    ['the caller', {timeoutMs: 50}, {}, 50],
    [
      'EXTENSION_TELEMETRY_TIMEOUT_MS',
      {},
      {EXTENSION_TELEMETRY_TIMEOUT_MS: '50'},
      50
    ],
    [
      'the caller over the env',
      {timeoutMs: 30},
      {EXTENSION_TELEMETRY_TIMEOUT_MS: '50'},
      30
    ],
    ['a floor of one millisecond', {timeoutMs: 0}, {}, 1]
  ])('aborts at the ceiling %s sets', async (_name, init, env, ceiling) => {
    vi.useFakeTimers()
    const attempt: Attempt = {aborted: false, settled: null}
    const box = sandbox({
      env,
      deps: {send: slowSender(attempt, COLD_ROUND_TRIP_MS)}
    })
    const flushed = trackCreate(box, init).flush()

    await vi.advanceTimersByTimeAsync(ceiling - 1)
    expect(attempt).toEqual({aborted: false, settled: null})

    await vi.advanceTimersByTimeAsync(1)
    await flushed

    expect(attempt).toEqual({aborted: true, settled: 'aborted'})
  })

  it('aborts every send at once when the timeout knob is not a number', async () => {
    vi.useFakeTimers()
    const attempt: Attempt = {aborted: false, settled: null}
    const box = sandbox({
      env: {EXTENSION_TELEMETRY_TIMEOUT_MS: '2s'},
      deps: {send: slowSender(attempt, COLD_ROUND_TRIP_MS)}
    })
    const flushed = trackCreate(box).flush()

    await vi.advanceTimersByTimeAsync(1)
    await flushed

    // Pins today's behavior. Ledger 1372 D32.
    expect(attempt).toEqual({aborted: true, settled: 'aborted'})
  })
})

describe('a sender that fails', () => {
  it('resolves the flush when the sender rejects, and drops the batch', async () => {
    const calls: string[] = []
    const box = sandbox({
      deps: {
        send: async (url) => {
          calls.push(url)

          throw new Error('ECONNREFUSED')
        }
      }
    })
    const telemetry = trackCreate(box)

    await expect(telemetry.flush()).resolves.toBeUndefined()
    await telemetry.flush()

    // The batch left the queue on the first try, so nothing is sent twice.
    expect(calls).toEqual(['http://127.0.0.1:9/capture/'])
    // The audit line was written before the send, so it stays.
    expect(readRows(path.join(box.configDir, 'events.jsonl'))).toHaveLength(1)
  })

  it('resolves the flush when the sender throws before it returns', async () => {
    const box = sandbox({
      deps: {
        send: () => {
          throw new Error('bad url')
        }
      }
    })

    await expect(trackCreate(box).flush()).resolves.toBeUndefined()
  })

  it('waits on a sender that never answers until the ceiling aborts it', async () => {
    vi.useFakeTimers()
    let aborted = false
    const box = sandbox({
      deps: {
        send: (_url, {signal}) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              aborted = true
              reject(new Error('aborted'))
            })
          })
      }
    })
    let done = false
    const flushed = trackCreate(box, {timeoutMs: 2000})
      .flush()
      .then(() => {
        done = true
      })

    await vi.advanceTimersByTimeAsync(1999)
    expect({aborted, done}).toEqual({aborted: false, done: false})

    await vi.advanceTimersByTimeAsync(1)
    await flushed
    expect({aborted, done}).toEqual({aborted: true, done: true})
  })
})

describe('what the flush sends and where', () => {
  it('posts one batch to the capture path of the host, under the key', async () => {
    const box = sandbox({env: {POSTHOG_KEY: 'phc_spec'}})
    await trackCreate(box).flush()

    expect(box.sent.map(({url, apiKey}) => ({url, apiKey}))).toEqual([
      {url: 'http://127.0.0.1:9/capture/', apiKey: 'phc_spec'}
    ])
  })

  it('uses the built-in host and key when the env names neither', async () => {
    const box = sandbox({env: {POSTHOG_HOST: undefined, POSTHOG_KEY: ''}})
    await trackCreate(box).flush()

    expect(box.sent.map(({url, apiKey}) => ({url, apiKey}))).toEqual([
      {
        url: 'https://us.i.posthog.com/capture/',
        apiKey: 'phc_Np5x3Jg3h2V7kTFtNch2uz6QBaWDycQpIidzX5PetaN'
      }
    ])
  })

  it('keeps the local audit and sends nothing without a key', async () => {
    const box = sandbox()
    const keyless = trackCreate(box, {apiKey: ''})

    await keyless.flush()

    expect(keyless.flushSync(1000)).toBe(false)
    expect(box.sent).toEqual([])
    expect(box.crashSent).toEqual([])
    expect(
      readRows(path.join(box.configDir, 'events.jsonl')).map(
        (row) => `${row.event}:${row.properties.command}`
      )
    ).toEqual(['command_executed:create'])
  })

  it('sends nothing without a host', async () => {
    const box = sandbox()
    const hostless = trackCreate(box, {host: ''})

    await hostless.flush()

    expect(hostless.flushSync(1000)).toBe(false)
    expect(box.sent).toEqual([])
  })

  it('sends nothing with an empty queue', async () => {
    const box = sandbox()
    const telemetry = box.telemetry({})

    await telemetry.flush()

    expect(telemetry.flushSync(1000)).toBe(false)
    expect(box.sent).toEqual([])
    expect(box.crashSent).toEqual([])
  })
})

describe('the crash flush', () => {
  it.each([
    [1000, 750, 1000],
    [1500, 1250, 1500],
    [100, 1, 100],
    [0, 1, 1]
  ])('gives a budget of %i ms a send timeout of %i ms inside %i ms', (budget, timeoutMs, budgetMs) => {
    const box = sandbox()

    expect(trackCreate(box).flushSync(budget)).toBe(true)
    expect(
      box.crashSent.map((send) => ({
        url: send.url,
        timeoutMs: send.timeoutMs,
        budgetMs: send.budgetMs,
        commands: send.rows.map((row) => row.properties.command)
      }))
    ).toEqual([
      {
        url: 'http://127.0.0.1:9/capture/',
        timeoutMs,
        budgetMs,
        commands: ['create']
      }
    ])
  })

  it('answers what the sender answered, and sends a batch once', () => {
    const box = sandbox({deps: {sendSync: () => false}})
    const telemetry = trackCreate(box)

    expect(telemetry.flushSync(1000)).toBe(false)
    expect(telemetry.flushSync(1000)).toBe(false)
  })

  it('answers false when the sender throws', () => {
    const box = sandbox({
      deps: {
        sendSync: () => {
          throw new Error('spawn E2BIG')
        }
      }
    })

    expect(trackCreate(box).flushSync(1000)).toBe(false)
  })
})

// The production senders, each pointed at a server on loopback.
describe('the default senders', () => {
  it('posts JSON to the capture path with fetch', async () => {
    const seen: Array<{
      method?: string
      url?: string
      type?: string
      body: string
    }> = []
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })

      req.on('end', () => {
        seen.push({
          method: req.method,
          url: req.url,
          type: req.headers['content-type'],
          body
        })

        res.end('{"status":1}')
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

    try {
      const {port} = server.address() as AddressInfo
      const box = sandbox({env: {POSTHOG_HOST: `http://127.0.0.1:${port}`}})
      const telemetry = new Telemetry(
        {app: 'extension', version: '9.9.9'},
        createTelemetryKit({...box.deps, send: undefined})
      )

      telemetry.track('command_failed', {
        command: 'build',
        success: false,
        version: '9.9.9'
      })

      await telemetry.flush()

      expect(seen.map(({method, url, type}) => ({method, url, type}))).toEqual([
        {method: 'POST', url: '/capture/', type: 'application/json'}
      ])

      const body = JSON.parse(seen[0].body) as {
        api_key: string
        batch: SentRow[]
      }
      expect(body.api_key).toBe(
        'phc_Np5x3Jg3h2V7kTFtNch2uz6QBaWDycQpIidzX5PetaN'
      )

      expect(body.batch.map((row) => row.event)).toEqual(['command_failed'])
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  // The crash sender blocks this thread, so the server runs on another one.
  async function serverOnAnotherThread(status: number) {
    const worker = new Worker(
      `
      const http = require('node:http')
      const {parentPort, workerData} = require('node:worker_threads')
      const server = http.createServer((req, res) => {
        let body = ''
        req.on('data', (c) => { body += c })
        req.on('end', () => {
          parentPort.postMessage({type: 'request', method: req.method, url: req.url, body})
          res.statusCode = workerData.status
          res.end('{}')
        })
      })
      server.listen(0, '127.0.0.1', () => {
        parentPort.postMessage({type: 'listening', port: server.address().port})
      })
      parentPort.on('message', () => server.close(() => process.exit(0)))
      `,
      {eval: true, workerData: {status}}
    )

    let firstRequest: (message: Record<string, unknown>) => void = () => {}

    const requested = new Promise<Record<string, unknown>>((resolve) => {
      firstRequest = resolve
    })
    const port = await new Promise<number>((resolve) => {
      worker.on('message', (message) => {
        if (message.type === 'listening') resolve(message.port)
        if (message.type === 'request') firstRequest(message)
      })
    })

    return {port, requested, stop: () => worker.terminate()}
  }

  it.each([
    [200, true],
    [500, false]
  ])('answers a crash send acknowledged with %i as %s', async (status, acknowledged) => {
    const server = await serverOnAnotherThread(status)

    try {
      const box = sandbox({
        env: {POSTHOG_HOST: `http://127.0.0.1:${server.port}`}
      })
      const crash = new Telemetry(
        {app: 'extension', version: '9.9.9'},
        createTelemetryKit({...box.deps, sendSync: undefined})
      )

      crash.track('command_failed', {
        command: 'build',
        success: false,
        version: '9.9.9',
        code: 'E_INTERNAL'
      })

      expect(crash.flushSync(5000)).toBe(acknowledged)

      const request = await server.requested
      expect(request).toMatchObject({method: 'POST', url: '/capture/'})

      const body = JSON.parse(String(request.body)) as {batch: SentRow[]}
      expect(body.batch.map((row) => row.properties.code)).toEqual([
        'E_INTERNAL'
      ])
    } finally {
      await server.stop()
    }
  })
})
