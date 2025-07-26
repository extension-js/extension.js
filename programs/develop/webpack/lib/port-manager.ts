import * as net from 'net'
import {DevOptions} from '../../commands/commands-lib/config-types'

export interface PortAllocation {
  port: number
}

// Simplified port manager for Extension.js development server
// Since only one browser runs at a time, we use a single port
export class PortManager {
  private readonly basePort: number

  constructor(_browser: DevOptions['browser'], basePort: number = 8080) {
    this.basePort = basePort
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer()
      server.once('error', () => resolve(false))
      server.once('listening', () => {
        server.close()
        resolve(true)
      })
      server.listen(port)
    })
  }

  private async findAvailablePort(startPort: number): Promise<number> {
    let port = startPort
    while (!(await this.isPortAvailable(port))) {
      port++
    }
    return port
  }

  async allocatePorts(requestedPort?: number): Promise<PortAllocation> {
    const port = requestedPort
      ? await this.findAvailablePort(requestedPort)
      : await this.findAvailablePort(this.basePort)

    return {port}
  }

  getPortInfo(allocation: PortAllocation): string {
    return `Port: ${allocation.port}`
  }
}
