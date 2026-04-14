import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {PassThrough} from 'stream'

vi.mock('../../run-chromium/chromium-source-inspection/discovery', () => ({
  discoverWebSocketDebuggerUrl: vi.fn(),
  checkChromeRemoteDebugging: vi.fn(async () => true)
}))

vi.mock('../../run-chromium/chromium-source-inspection/ws', () => ({
  establishBrowserConnection: vi.fn()
}))

import {CDPClient} from '../../run-chromium/chromium-source-inspection/cdp-client'

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
    } catch {}
    pipeIn.destroy()
    pipeOut.destroy()
  })

  // -----------------------------------------------------------------------
  // 1. connectViaPipe sets up the pipe transport
  // -----------------------------------------------------------------------

  it('connects via pipe and reports isConnected', async () => {
    await client.connectViaPipe(pipeIn, pipeOut)
    expect(client.isConnected()).toBe(true)
  })

  // -----------------------------------------------------------------------
  // 2. sendCommand writes null-byte delimited JSON to pipe
  // -----------------------------------------------------------------------

  it('sends null-byte delimited JSON through pipe', async () => {
    await client.connectViaPipe(pipeIn, pipeOut)

    const chunks: Buffer[] = []
    pipeOut.on('data', (chunk: Buffer) => chunks.push(chunk))

    const promise = client.sendCommand('Target.getTargets', {})

    // Let the write flush
    await new Promise((r) => setTimeout(r, 0))

    const written = Buffer.concat(chunks).toString('utf-8')
    // Should end with null byte
    expect(written.endsWith('\0')).toBe(true)

    const json = JSON.parse(written.slice(0, -1))
    expect(json.method).toBe('Target.getTargets')
    expect(typeof json.id).toBe('number')

    // Respond via pipe
    const response = JSON.stringify({id: json.id, result: {targetInfos: []}})
    pipeIn.write(Buffer.from(response + '\0'))

    const result = await promise
    expect(result).toEqual({targetInfos: []})
  })

  // -----------------------------------------------------------------------
  // 3. Handles multiple messages in a single chunk
  // -----------------------------------------------------------------------

  it('parses multiple null-byte delimited messages from one chunk', async () => {
    await client.connectViaPipe(pipeIn, pipeOut)

    // Discard writes
    pipeOut.on('data', () => {})

    const p1 = client.sendCommand('Target.getTargets')
    const p2 = client.sendCommand('Browser.getVersion')

    await new Promise((r) => setTimeout(r, 0))

    // Find the IDs from what was written
    const sent: any[] = []
    pipeOut.removeAllListeners('data')
    // Re-read — the messages already flushed. Use handleMessage directly.
    // Instead, manually extract IDs from the pending requests
    const pendingIds = Array.from(
      (client as any).pendingRequests.keys()
    ) as number[]
    expect(pendingIds).toHaveLength(2)

    // Send both responses in one chunk
    const r1 = JSON.stringify({id: pendingIds[0], result: {targetInfos: []}})
    const r2 = JSON.stringify({
      id: pendingIds[1],
      result: {product: 'Chrome/130'}
    })
    pipeIn.write(Buffer.from(r1 + '\0' + r2 + '\0'))

    await expect(p1).resolves.toEqual({targetInfos: []})
    await expect(p2).resolves.toEqual({product: 'Chrome/130'})
  })

  // -----------------------------------------------------------------------
  // 4. Handles a message split across multiple chunks
  // -----------------------------------------------------------------------

  it('reassembles messages split across multiple data events', async () => {
    await client.connectViaPipe(pipeIn, pipeOut)
    pipeOut.on('data', () => {})

    const promise = client.sendCommand('Runtime.evaluate', {expression: '1+1'})

    await new Promise((r) => setTimeout(r, 0))

    const pendingIds = Array.from(
      (client as any).pendingRequests.keys()
    ) as number[]
    const response = JSON.stringify({id: pendingIds[0], result: {value: 2}})

    // Split the response across two chunks
    const mid = Math.floor(response.length / 2)
    pipeIn.write(Buffer.from(response.slice(0, mid)))
    pipeIn.write(Buffer.from(response.slice(mid) + '\0'))

    await expect(promise).resolves.toEqual({value: 2})
  })

  // -----------------------------------------------------------------------
  // 5. Rejects pending requests when pipe closes
  // -----------------------------------------------------------------------

  it('rejects pending requests when pipe closes', async () => {
    await client.connectViaPipe(pipeIn, pipeOut)
    pipeOut.on('data', () => {})

    const promise = client.sendCommand('Target.getTargets')
    await new Promise((r) => setTimeout(r, 0))

    pipeIn.destroy()

    await expect(promise).rejects.toThrow('CDP pipe closed')
  })

  // -----------------------------------------------------------------------
  // 6. isConnected returns false after disconnect
  // -----------------------------------------------------------------------

  it('reports disconnected after disconnect()', async () => {
    await client.connectViaPipe(pipeIn, pipeOut)
    expect(client.isConnected()).toBe(true)

    client.disconnect()
    expect(client.isConnected()).toBe(false)
  })

  // -----------------------------------------------------------------------
  // 7. sendCommand rejects when pipe is not connected
  // -----------------------------------------------------------------------

  it('rejects sendCommand when pipe transport is not connected', async () => {
    await client.connectViaPipe(pipeIn, pipeOut)
    client.disconnect()

    await expect(client.sendCommand('Target.getTargets')).rejects.toThrow(
      'CDP transport is not open'
    )
  })
})
