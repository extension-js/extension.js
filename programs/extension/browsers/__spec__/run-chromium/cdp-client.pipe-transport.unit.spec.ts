import {PassThrough} from 'node:stream'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('../../run-chromium/cdp/discovery', () => ({
  discoverWebSocketDebuggerUrl: vi.fn(),
  checkChromeRemoteDebugging: vi.fn(async () => true)
}))

vi.mock('../../run-chromium/cdp/ws', () => ({
  establishBrowserConnection: vi.fn()
}))

import {CDPClient} from '../../run-chromium/cdp/cdp-client'

describe('CDPClient pipe transport', () => {
  let client: CDPClient
  let pipeIn: PassThrough
  let pipeOut: PassThrough

  beforeEach(() => {
    client = new CDPClient(0, '127.0.0.1')
    pipeIn = new PassThrough()
    pipeOut = new PassThrough()
  })

  afterEach(() => {
    try {
      client.disconnect()
    } catch {
      // Ignore
    }
    pipeIn.destroy()
    pipeOut.destroy()
  })

  it('connects via pipe and reports isConnected', async () => {
    await client.connectViaPipe(pipeIn, pipeOut)
    expect(client.isConnected()).toBe(true)
  })

  it('sends null-byte delimited JSON through pipe', async () => {
    await client.connectViaPipe(pipeIn, pipeOut)

    const chunks: Buffer[] = []
    pipeOut.on('data', (chunk: Buffer) => chunks.push(chunk))

    const promise = client.sendCommand('Target.getTargets', {})

    await new Promise((r) => setTimeout(r, 0))

    const written = Buffer.concat(chunks).toString('utf-8')
    expect(written.endsWith('\0')).toBe(true)

    const json = JSON.parse(written.slice(0, -1))
    expect(json.method).toBe('Target.getTargets')
    expect(typeof json.id).toBe('number')

    const response = JSON.stringify({id: json.id, result: {targetInfos: []}})
    pipeIn.write(Buffer.from(`${response}\0`))

    const result = await promise
    expect(result).toEqual({targetInfos: []})
  })

  it('parses multiple null-byte delimited messages from one chunk', async () => {
    await client.connectViaPipe(pipeIn, pipeOut)

    pipeOut.on('data', () => {})

    const p1 = client.sendCommand('Target.getTargets')
    const p2 = client.sendCommand('Browser.getVersion')

    await new Promise((r) => setTimeout(r, 0))

    const sent: any[] = []
    pipeOut.removeAllListeners('data')
    const pendingIds = Array.from(
      (client as any).pendingRequests.keys()
    ) as number[]
    expect(pendingIds).toHaveLength(2)

    const r1 = JSON.stringify({id: pendingIds[0], result: {targetInfos: []}})
    const r2 = JSON.stringify({
      id: pendingIds[1],
      result: {product: 'Chrome/130'}
    })
    pipeIn.write(Buffer.from(`${r1}\0${r2}\0`))

    await expect(p1).resolves.toEqual({targetInfos: []})
    await expect(p2).resolves.toEqual({product: 'Chrome/130'})
  })

  it('reassembles messages split across multiple data events', async () => {
    await client.connectViaPipe(pipeIn, pipeOut)
    pipeOut.on('data', () => {})

    const promise = client.sendCommand('Runtime.evaluate', {expression: '1+1'})

    await new Promise((r) => setTimeout(r, 0))

    const pendingIds = Array.from(
      (client as any).pendingRequests.keys()
    ) as number[]
    const response = JSON.stringify({id: pendingIds[0], result: {value: 2}})

    const mid = Math.floor(response.length / 2)
    pipeIn.write(Buffer.from(response.slice(0, mid)))
    pipeIn.write(Buffer.from(`${response.slice(mid)}\0`))

    await expect(promise).resolves.toEqual({value: 2})
  })

  it('rejects pending requests when pipe closes', async () => {
    await client.connectViaPipe(pipeIn, pipeOut)
    pipeOut.on('data', () => {})

    const promise = client.sendCommand('Target.getTargets')
    await new Promise((r) => setTimeout(r, 0))

    pipeIn.destroy()

    await expect(promise).rejects.toThrow('CDP pipe closed')
  })

  it('reports disconnected after disconnect()', async () => {
    await client.connectViaPipe(pipeIn, pipeOut)
    expect(client.isConnected()).toBe(true)

    client.disconnect()
    expect(client.isConnected()).toBe(false)
  })

  it('rejects sendCommand when pipe transport is not connected', async () => {
    await client.connectViaPipe(pipeIn, pipeOut)
    client.disconnect()

    await expect(client.sendCommand('Target.getTargets')).rejects.toThrow(
      'CDP transport is not open'
    )
  })
})
