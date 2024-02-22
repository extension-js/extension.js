// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as net from 'net'

export default async function getNextAvailablePort(
  startPort: number = 8000
): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        resolve(getNextAvailablePort(startPort + 1))
      } else {
        reject(err)
      }
    })

    server.listen(startPort, () => {
      const port = (server.address() as net.AddressInfo).port
      server.close(() => {
        resolve(port)
      })
    })
  })
}
