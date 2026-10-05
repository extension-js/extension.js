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

  it('disconnect removes only its own listeners from the child stdio streams', async () => {
    // child_process counts the stdio 'close' events to fire the child's own
    // 'close', which is where a browser exit is reported. Those listeners are
    // not ours to remove.
    const childClose = vi.fn()
    const childWriteClose = vi.fn()
    pipeIn.on('close', childClose)
    pipeOut.on('close', childWriteClose)

    await client.connectViaPipe(pipeIn, pipeOut)
    expect(pipeIn.listeners('close')).toContain(childClose)
    expect(pipeIn.listenerCount('data')).toBe(1)
    expect(pipeOut.listenerCount('error')).toBe(2)

    client.disconnect()

    expect(pipeIn.listeners('close')).toEqual([childClose])
    expect(pipeOut.listeners('close')).toEqual([childWriteClose])
    expect(pipeIn.listenerCount('data')).toBe(0)
    // One guard stays, so a reset after the detach is never left uncaught.
    expect(pipeIn.listenerCount('error')).toBe(1)
    expect(pipeOut.listenerCount('error')).toBe(1)

    pipeIn.destroy()
    await new Promise((r) => setTimeout(r, 0))
    expect(childClose).toHaveBeenCalledTimes(1)
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

describe('CDPClient pipe transport when the browser dies mid-write', () => {
  function brokenPipe() {
    const {Writable} = require('node:stream') as typeof import('node:stream')

    return new Writable({
      write(_chunk, _encoding, callback) {
        const error = new Error('write EPIPE') as Error & {code?: string}
        error.code = 'EPIPE'
        callback(error)
      }
    })
  }

  it('reports the transport gone instead of throwing out of the write', async () => {
    const client = new CDPClient(0, '127.0.0.1')
    const pipeIn = new PassThrough()
    const reasons: string[] = []
    client.onTransportGone = (reason: string) => reasons.push(reason)

    await client.connectViaPipe(pipeIn, brokenPipe())

    await expect(client.sendCommand('Target.getTargets')).rejects.toThrow(
      /EPIPE/
    )

    expect(client.isTransportGone()).toBe(true)
    expect(reasons.length).toBeGreaterThan(0)
    client.disconnect()
    pipeIn.destroy()
  })

  it('says the transport is gone only once', async () => {
    const client = new CDPClient(0, '127.0.0.1')
    const pipeIn = new PassThrough()
    const reasons: string[] = []
    client.onTransportGone = (reason: string) => reasons.push(reason)

    await client.connectViaPipe(pipeIn, brokenPipe())

    await client.sendCommand('Target.getTargets').catch(() => undefined)
    await client.sendCommand('Target.getTargets').catch(() => undefined)

    expect(reasons).toHaveLength(1)
    client.disconnect()
    pipeIn.destroy()
  })

  it('reports the transport gone when the read side closes', async () => {
    const client = new CDPClient(0, '127.0.0.1')
    const pipeIn = new PassThrough()
    const pipeOut = new PassThrough()
    const reasons: string[] = []
    client.onTransportGone = (reason: string) => reasons.push(reason)

    await client.connectViaPipe(pipeIn, pipeOut)
    pipeIn.destroy()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(client.isTransportGone()).toBe(true)
    expect(reasons).toHaveLength(1)
    client.disconnect()
    pipeOut.destroy()
  })

  it('leaves a healthy pipe reporting a live transport', async () => {
    const client = new CDPClient(0, '127.0.0.1')
    const pipeIn = new PassThrough()
    const pipeOut = new PassThrough()

    await client.connectViaPipe(pipeIn, pipeOut)

    expect(client.isTransportGone()).toBe(false)
    client.disconnect()
    pipeIn.destroy()
    pipeOut.destroy()
  })
})

describe('CDPClient pipe transport when the browser resets the read side', () => {
  function econnreset() {
    const error = new Error('read ECONNRESET') as Error & {code?: string}
    error.code = 'ECONNRESET'

    return error
  }

  function brokenPipe() {
    const {Writable} = require('node:stream') as typeof import('node:stream')

    return new Writable({
      write(_chunk, _encoding, callback) {
        const error = new Error('write EPIPE') as Error & {code?: string}
        error.code = 'EPIPE'
        callback(error)
      }
    })
  }

  it('reports the transport gone when the read side errors', async () => {
    const client = new CDPClient(0, '127.0.0.1')
    const pipeIn = new PassThrough()
    const pipeOut = new PassThrough()
    const reasons: string[] = []
    client.onTransportGone = (reason: string) => reasons.push(reason)

    await client.connectViaPipe(pipeIn, pipeOut)
    const pending = client.sendCommand('Target.getTargets')
    pipeIn.emit('error', econnreset())

    await expect(pending).rejects.toThrow(/ECONNRESET/)
    expect(client.isTransportGone()).toBe(true)
    expect(reasons).toEqual(['read ECONNRESET'])
    client.disconnect()
  })

  it('absorbs a reset that lands after the client detached', async () => {
    const client = new CDPClient(0, '127.0.0.1')
    const pipeIn = new PassThrough()
    const pipeOut = new PassThrough()
    const reasons: string[] = []
    client.onTransportGone = (reason: string) => reasons.push(reason)

    await client.connectViaPipe(pipeIn, pipeOut)
    client.disconnect()

    expect(() => pipeIn.emit('error', econnreset())).not.toThrow()
    expect(() => pipeOut.emit('error', econnreset())).not.toThrow()
    expect(reasons).toEqual(['read ECONNRESET'])
  })

  it('absorbs the reset that follows a handshake the dead browser refused', async () => {
    const {connectToChromeCdpViaPipe} = await import(
      '../../run-chromium/cdp/cdp-extension-controller/connect'
    )
    const pipeIn = new PassThrough()
    const pipeOut = brokenPipe()
    const reasons: string[] = []

    await expect(
      connectToChromeCdpViaPipe(pipeIn, pipeOut, 0, '127.0.0.1', (reason) =>
        reasons.push(reason)
      )
    ).rejects.toThrow(/EPIPE/)

    expect(() => pipeOut.emit('error', econnreset())).not.toThrow()
    expect(() => pipeIn.emit('error', econnreset())).not.toThrow()
    expect(reasons).toEqual(['write EPIPE'])
  })

  it('absorbs a reset before any client attached once the launcher guards it', async () => {
    const {guardCdpPipe} = await import('../../run-chromium/cdp/pipe-guard')
    const pipeIn = new PassThrough()

    guardCdpPipe(pipeIn)
    guardCdpPipe(pipeIn)

    expect(pipeIn.listenerCount('error')).toBe(1)
    expect(() => pipeIn.emit('error', econnreset())).not.toThrow()
  })
})
