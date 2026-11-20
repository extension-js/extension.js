import * as net from 'node:net'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {WebSocketServer} from 'ws'
import {BridgeBroker} from '../broker'
import type {BridgeTarget} from '../contracts'
import {LOG_CONTEXTS} from '../contracts'
import {startControlServer} from '../ws-control-server'

let holder: net.Server | undefined

afterEach(async () => {
  vi.restoreAllMocks()
  await new Promise<void>((done) =>
    holder ? holder.close(() => done()) : done()
  )

  holder = undefined
})

describe('a control server whose port is taken', () => {
  it('rejects with the bind failure and closes what it opened', async () => {
    holder = net.createServer()
    await new Promise<void>((done) => holder?.listen(0, '127.0.0.1', done))

    const {port} = holder.address() as net.AddressInfo
    const close = vi.spyOn(WebSocketServer.prototype, 'close')

    await expect(
      startControlServer({
        broker: new BridgeBroker({instanceId: 'inst-1', runId: 'run-A'}),
        port
      })
    ).rejects.toMatchObject({code: 'EADDRINUSE'})

    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('the target of a controller command', () => {
  it('takes every context a log event can name', () => {
    const targets: BridgeTarget[] = LOG_CONTEXTS.map((context) => ({context}))

    expect(targets.map((target) => target.context)).toContain('newtab')
  })
})
