import * as http from 'node:http'
import * as net from 'node:net'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {PortManager} from '../port-manager'
import {reservedHttpServer} from '../reserved-listen'

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
})

function track(server: net.Server) {
  closers.push(
    () =>
      new Promise((resolve) => {
        if (!server.listening) return resolve()

        server.close(() => resolve())
      })
  )

  return server
}

function bindCompetitor(port: number): Promise<string> {
  return new Promise((resolve) => {
    const competitor = net.createServer()
    competitor.once('error', (error: NodeJS.ErrnoException) =>
      resolve(String(error.code))
    )

    competitor.listen(port, '127.0.0.1', () => {
      track(competitor)
      resolve('bound')
    })
  })
}

function get(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    http
      .get({host: '127.0.0.1', port}, (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => resolve(body))
      })
      .on('error', reject)
  })
}

const app: http.RequestListener = (_req, res) => res.end('dev-server')

describe('reservedHttpServer', () => {
  it('listens on the reserved socket so no one can take the port before the bind', async () => {
    const manager = new PortManager(0)
    const {port} = await manager.allocatePorts(0, '127.0.0.1')
    const onBindError = vi.fn()
    const server = track(
      reservedHttpServer({
        takeReservation: () => manager.takeReservation(),
        onBindError
      })(undefined, app)
    )

    const listening = new Promise<void>((resolve) =>
      server.listen({host: '127.0.0.1', port}, () => resolve())
    )
    const competitor = bindCompetitor(port)

    await listening
    expect(await competitor).toBe('EADDRINUSE')
    expect(await get(port)).toBe('dev-server')
    expect(onBindError).not.toHaveBeenCalled()
    expect(manager.takeReservation()).toBeNull()
  })

  it('frees the port when the server closes', async () => {
    const manager = new PortManager(0)
    const {port} = await manager.allocatePorts(0, '127.0.0.1')
    const server = reservedHttpServer({
      takeReservation: () => manager.takeReservation(),
      onBindError: vi.fn()
    })(undefined, app)

    await new Promise<void>((resolve) =>
      server.listen({host: '127.0.0.1', port}, () => resolve())
    )

    await new Promise<void>((resolve) => server.close(() => resolve()))

    expect(await bindCompetitor(port)).toBe('bound')
  })

  it('reports a bind failure to onBindError instead of the error listeners', async () => {
    const holder = track(net.createServer())
    await new Promise<void>((resolve) =>
      holder.listen(0, '127.0.0.1', () => resolve())
    )

    const {port} = holder.address() as net.AddressInfo
    const onBindError = vi.fn()
    const thrower = vi.fn()
    const server = track(
      reservedHttpServer({takeReservation: () => null, onBindError})(
        undefined,
        app
      )
    )
    server.on('error', thrower)

    server.listen({host: '127.0.0.1', port})
    await vi.waitFor(() => expect(onBindError).toHaveBeenCalledTimes(1))

    expect(onBindError.mock.calls[0][0].code).toBe('EADDRINUSE')
    expect(thrower).not.toHaveBeenCalled()
  })

  it('binds normally when the reservation names another port', async () => {
    const manager = new PortManager(0)
    await manager.allocatePorts(0, '127.0.0.1')
    const other = track(net.createServer())
    await new Promise<void>((resolve) =>
      other.listen(0, '127.0.0.1', () => resolve())
    )

    const {port: otherPort} = other.address() as net.AddressInfo
    await new Promise<void>((resolve) => other.close(() => resolve()))

    const server = track(
      reservedHttpServer({
        takeReservation: () => manager.takeReservation(),
        onBindError: vi.fn()
      })(undefined, app)
    )

    await new Promise<void>((resolve) =>
      server.listen({host: '127.0.0.1', port: otherPort}, () => resolve())
    )

    expect(await get(otherPort)).toBe('dev-server')
  })
})
