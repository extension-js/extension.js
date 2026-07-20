// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as crypto from 'node:crypto'
import * as net from 'node:net'

async function findAvailablePortNear(
  startPort: number,
  maxAttempts: number = 20,
  host: string = '127.0.0.1'
): Promise<number> {
  // Port 0 means "let the OS pick a free port". We must read the actual
  // assigned port from server.address() instead of returning 0.
  if (startPort === 0) {
    return new Promise((resolve, reject) => {
      const server = net.createServer()
      server.once('error', (err) => reject(err))
      server.once('listening', () => {
        const addr = server.address() as net.AddressInfo
        server.close(() => resolve(addr.port))
      })
      server.listen(0, host)
    })
  }

  function tryPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer()
      server.once('error', () => resolve(false))
      server.once('listening', () => {
        server.close(() => resolve(true))
      })
      server.listen(port, host)
    })
  }

  let candidate = startPort
  for (let i = 0; i < maxAttempts; i++) {
    const ok = await tryPort(candidate)
    if (ok) return candidate
    candidate += 1
  }
  throw new Error(
    `Could not find an available port near ${startPort} after ${maxAttempts} attempts`
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
    const port = await findAvailablePortNear(base, undefined, host)
    const instanceId =
      resolveInstanceIdOverride() || crypto.randomBytes(8).toString('hex')

    this.currentInstance = {instanceId, port}

    return {port, instanceId}
  }

  getCurrentInstance(): LocalInstanceInfo | null {
    return this.currentInstance
  }

  async terminateCurrentInstance(): Promise<void> {
    this.currentInstance = null
  }
}
