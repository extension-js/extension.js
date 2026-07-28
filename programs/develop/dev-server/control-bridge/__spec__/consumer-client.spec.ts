import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {BridgeBroker} from '../broker'
import {
  BridgeConsumer,
  type ConsumerCloseInfo,
  readReadyContract,
  readReadyContractDocument
} from '../consumer-client'
import {CLOSE_BAD_INSTANCE, type IncomingLogEvent} from '../contracts'
import {LogRingBuffer} from '../ring-buffer'
import {type ControlServer, startControlServer} from '../ws-control-server'

function incoming(message: string): IncomingLogEvent {
  return {
    v: 1,
    id: Math.random().toString(36).slice(2),
    timestamp: 0,
    level: 'info',
    context: 'background',
    messageParts: [message],
    runId: 'run-A'
  }
}

describe('readReadyContract', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ready-'))
  })
  afterEach(() => fs.rmSync(dir, {recursive: true, force: true}))

  function writeReady(obj: unknown) {
    const d = path.join(dir, 'dist', 'extension-js', 'chrome')
    fs.mkdirSync(d, {recursive: true})
    fs.writeFileSync(path.join(d, 'ready.json'), JSON.stringify(obj))
  }

  it('reads controlPort and instanceId', () => {
    writeReady({
      controlPort: 8147,
      instanceId: 'inst-1',
      runId: 'r',
      status: 'ready'
    })
    expect(readReadyContract(dir, 'chrome')).toMatchObject({
      controlPort: 8147,
      instanceId: 'inst-1'
    })
  })

  it('returns null when controlPort is absent', () => {
    writeReady({instanceId: 'inst-1', runId: 'r'})
    expect(readReadyContract(dir, 'chrome')).toBeNull()
  })

  it('returns null when there is no ready.json', () => {
    expect(readReadyContract(dir, 'chrome')).toBeNull()
  })

  it('carries schema and schemaVersion through the narrow reader', () => {
    writeReady({
      schemaVersion: 2,
      schema: 1,
      controlPort: 8147,
      instanceId: 'inst-1',
      runId: 'r'
    })
    expect(readReadyContract(dir, 'chrome')).toMatchObject({
      schemaVersion: 2,
      schema: 1
    })
  })
})

describe('readReadyContractDocument', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ready-doc-'))
  })
  afterEach(() => fs.rmSync(dir, {recursive: true, force: true}))

  function writeReady(obj: unknown) {
    const d = path.join(dir, 'dist', 'extension-js', 'chrome')
    fs.mkdirSync(d, {recursive: true})
    fs.writeFileSync(path.join(d, 'ready.json'), JSON.stringify(obj))
  }

  it('passes the whole document through, including failure evidence', () => {
    const written = {
      schemaVersion: 2,
      schema: 1,
      status: 'error',
      command: 'dev',
      browser: 'chrome',
      runId: 'run-A',
      distPath: '/proj/dist/chrome',
      manifestPath: '/proj/manifest.json',
      toolchainVersion: '4.0.18',
      rdpPort: 6006,
      code: 'compile_error',
      message: 'Compilation failed',
      errors: ['x is not defined']
    }
    writeReady(written)
    expect(readReadyContractDocument(dir, 'chrome')).toEqual(written)
  })

  it('does not require controlPort or instanceId', () => {
    writeReady({schemaVersion: 2, schema: 1, status: 'ready', runId: 'r'})
    expect(readReadyContractDocument(dir, 'chrome')).toMatchObject({
      schemaVersion: 2,
      schema: 1,
      status: 'ready'
    })
  })

  it('returns null for a missing, invalid, or non-object file', () => {
    expect(readReadyContractDocument(dir, 'chrome')).toBeNull()
    writeReady('not-an-object')
    expect(readReadyContractDocument(dir, 'chrome')).toBeNull()
    writeReady([1, 2])
    expect(readReadyContractDocument(dir, 'chrome')).toBeNull()
    const d = path.join(dir, 'dist', 'extension-js', 'chrome')
    fs.writeFileSync(path.join(d, 'ready.json'), '{broken')
    expect(readReadyContractDocument(dir, 'chrome')).toBeNull()
  })
})

describe('BridgeConsumer (integration)', () => {
  let server: ControlServer | null = null
  let consumer: BridgeConsumer | null = null

  afterEach(async () => {
    consumer?.close()
    consumer = null
    if (server) {
      await server.close()
      server = null
    }
  })

  it('receives ready, then a streamed log, then a gap', async () => {
    const ring = new LogRingBuffer(2)
    const broker = new BridgeBroker({
      instanceId: 'inst-1',
      runId: 'run-A',
      engine: 'chromium',
      ring
    })
    server = await startControlServer({broker})

    const logs: string[] = []
    let gapped = 0
    const ready = new Promise<void>((resolve) => {
      consumer = new BridgeConsumer({
        controlPort: server!.port,
        instanceId: 'inst-1',
        onReady: () => resolve(),
        onLog: (e) => logs.push(String(e.messageParts[0])),
        onGap: () => (gapped += 1)
      })
      consumer.start()
    })
    await ready

    broker.ingestLog(incoming('a'))
    broker.ingestLog(incoming('b'))
    broker.ingestLog(incoming('c'))

    await new Promise((r) => setTimeout(r, 150))
    expect(logs).toContain('a')
    expect(logs).toContain('c')
    expect(gapped).toBeGreaterThanOrEqual(1)
  })

  it('is rejected (no ready) when the instanceId is wrong', async () => {
    const broker = new BridgeBroker({instanceId: 'right', runId: 'run-A'})
    server = await startControlServer({broker})
    let readyCalled = false
    consumer = new BridgeConsumer({
      controlPort: server.port,
      instanceId: 'wrong',
      onReady: () => (readyCalled = true)
    })
    consumer.start()
    await new Promise((r) => setTimeout(r, 200))
    expect(readyCalled).toBe(false)
  })

  it('hands the close code and reason to onClose and records lastClose', async () => {
    const broker = new BridgeBroker({instanceId: 'right', runId: 'run-A'})
    server = await startControlServer({broker})
    const closes: ConsumerCloseInfo[] = []
    const c = new BridgeConsumer({
      controlPort: server.port,
      instanceId: 'wrong',
      onClose: (info) => closes.push(info)
    })
    consumer = c
    expect(c.lastClose).toBeNull()
    c.start()
    await new Promise((r) => setTimeout(r, 300))
    expect(closes).toEqual([
      {code: CLOSE_BAD_INSTANCE, reason: 'instanceId mismatch'}
    ])
    expect(c.lastClose).toEqual({
      code: CLOSE_BAD_INSTANCE,
      reason: 'instanceId mismatch'
    })
  })

  it('keeps a zero-argument onClose callback working', async () => {
    const broker = new BridgeBroker({instanceId: 'right', runId: 'run-A'})
    server = await startControlServer({broker})
    let closed = 0
    consumer = new BridgeConsumer({
      controlPort: server.port,
      instanceId: 'wrong',
      onClose: () => {
        closed += 1
      }
    })
    consumer.start()
    await new Promise((r) => setTimeout(r, 300))
    expect(closed).toBe(1)
  })
})
