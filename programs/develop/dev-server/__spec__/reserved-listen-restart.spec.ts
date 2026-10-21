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

function devServer(manager: PortManager, body: string) {
  return track(
    reservedHttpServer({
      takeReservation: () => manager.takeReservation(),
      onBindError: vi.fn(),
      holdOnClose: () => manager.shouldHoldPortOnClose(),
      onHeld: (reservation) => manager.adoptHeldPort(reservation)
    })(undefined, (_req, res) => res.end(body))
  )
}

function listen(server: http.Server, port: number) {
  return new Promise<void>((resolve) =>
    server.listen({host: '127.0.0.1', port}, () => resolve())
  )
}

function close(server: http.Server) {
  return new Promise<void>((resolve) => server.close(() => resolve()))
}

describe('dev server restart on a fixed port', () => {
  it('keeps the port held between the old server stopping and the new one listening', async () => {
    const manager = new PortManager(0)
    const {port} = await manager.allocatePorts(0, '127.0.0.1')
    const first = devServer(manager, 'first')
    await listen(first, port)

    manager.holdPortAcrossRestart()
    await close(first)

    expect(await bindCompetitor(port)).toBe('EADDRINUSE')

    const next = devServer(manager, 'next')
    await listen(next, port)
    manager.endRestartHold()

    expect(await get(port)).toBe('next')
    expect(manager.takeReservation()).toBeNull()
  })

  it('frees the port when the session stops, not restarts', async () => {
    const manager = new PortManager(0)
    const {port} = await manager.allocatePorts(0, '127.0.0.1')
    const server = devServer(manager, 'only')
    await listen(server, port)

    await close(server)

    expect(await bindCompetitor(port)).toBe('bound')
  })

  it('holds only across one restart', async () => {
    const manager = new PortManager(0)
    const {port} = await manager.allocatePorts(0, '127.0.0.1')
    const first = devServer(manager, 'first')
    await listen(first, port)

    manager.holdPortAcrossRestart()
    await close(first)
    const next = devServer(manager, 'next')
    await listen(next, port)
    manager.endRestartHold()

    await close(next)

    expect(await bindCompetitor(port)).toBe('bound')
  })
})
