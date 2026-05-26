import {describe, it, expect, afterEach, beforeEach} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {BridgeConsumer, readReadyContract} from '../consumer-client'
import {startControlServer, type ControlServer} from '../ws-control-server'
import {BridgeBroker} from '../broker'
import {LogRingBuffer} from '../ring-buffer'
import type {IncomingLogEvent} from '../contracts'

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
    writeReady({controlPort: 8147, instanceId: 'inst-1', runId: 'r', status: 'ready'})
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
    broker.ingestLog(incoming('c')) // ring cap 2 -> overflow -> gap

    // allow frames to arrive
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
})
