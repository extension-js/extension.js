// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as crypto from 'node:crypto'
import * as net from 'node:net'
import {codedError} from '../lib/coded-error'
import {CODES} from '../lib/messaging'

interface PortReservation {
  port: number
  release(): Promise<void>
}

function closeReservation(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}

function reserve(port: number, host: string): Promise<net.Server | null> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(null))
    server.once('listening', () => resolve(server))
    // A reservation is not a server: dropping whatever dials it keeps close()
    // prompt and never answers a request meant for the dev server.
    server.on('connection', (socket) => socket.destroy())

    // A candidate past the last valid port throws before it can emit 'error',
    // and that is still a port this session cannot have.
    try {
      server.listen(port, host)
    } catch {
      resolve(null)
    }
  })
}

// The listener stays bound until the dev server is about to take the port.
// Probing by binding and closing made the number advisory, so everything
// between the probe and the real bind was a window for a second session to
// be handed the same port.
async function reservePortNear(
  startPort: number,
  maxAttempts: number = 20,
  host: string = '127.0.0.1'
): Promise<PortReservation> {
  // Port 0 means "let the OS pick a free port". We must read the actual
  // assigned port from server.address() instead of returning 0.
  const attempts = startPort === 0 ? 1 : maxAttempts
  let candidate = startPort

  for (let i = 0; i < attempts; i++) {
    const server = await reserve(candidate, host)

    if (server) {
      const address = server.address() as net.AddressInfo | null
      // The reservation must never be the reason the process stays alive.
      server.unref()

      return {
        port: address?.port ?? candidate,
        release: () => closeReservation(server)
      }
    }

    candidate += 1
  }

  throw codedError(
    CODES.E_PORT_UNAVAILABLE,
    `Could not find an available port near ${startPort} after ${attempts} attempts`
  )
}

export interface PortAllocation {
  port: number
  instanceId: string
}

// Minimal local representation; no global registry. The dev server multiplexes
// the HMR websocket onto the HTTP port (path `/ws`), so a single port suffices.
interface LocalInstanceInfo {
  instanceId: string
  port: number
  instanceExplicit: boolean
}

function resolveInstanceIdOverride(): string | undefined {
  const raw =
    process.env.EXTENSION_INSTANCE_ID ||
    process.env.EXTENSION_DEV_INSTANCE_ID ||
    process.env.EXTJS_INSTANCE_ID ||
    ''
  const value = String(raw).trim()

  if (!value) return undefined

  return value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64) || undefined
}

export class PortManager {
  private readonly basePort: number
  private currentInstance: LocalInstanceInfo | null = null
  private reservation: PortReservation | null = null

  constructor(basePort: number = 8080) {
    this.basePort = basePort
  }

  async allocatePorts(
    requestedPort?: number,
    host?: string
  ): Promise<PortAllocation> {
    const isValidRequested =
      typeof requestedPort === 'number' &&
      requestedPort >= 0 &&
      requestedPort < 65536
    const base = isValidRequested ? requestedPort : this.basePort
    await this.releaseReservedPort()
    const reservation = await reservePortNear(base, undefined, host)
    this.reservation = reservation
    const port = reservation.port
    // Read the override before anything exports a resolved id back into the
    // environment, or every later session would look user-pinned.
    const override = resolveInstanceIdOverride()
    const instanceId = override || crypto.randomBytes(8).toString('hex')

    this.currentInstance = {
      instanceId,
      port,
      instanceExplicit: override !== undefined
    }

    return {port, instanceId}
  }

  getCurrentInstance(): LocalInstanceInfo | null {
    return this.currentInstance
  }

  // The dev server cannot bind a port this process still holds, so the
  // reservation is dropped the moment the real listener takes over.
  async releaseReservedPort(): Promise<void> {
    const reservation = this.reservation
    this.reservation = null

    if (reservation) await reservation.release()
  }

  async terminateCurrentInstance(): Promise<void> {
    this.currentInstance = null
    await this.releaseReservedPort()
  }
}
