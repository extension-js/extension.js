import * as path from 'path'
import http from 'http'
import https from 'https'
import * as fs from 'fs'
import * as messages from '../../../../lib/messages'

const ensureFile = (filePath: string) => {
  if (!fs.existsSync(filePath)) {
    return undefined
  }

  const basename = path.basename(filePath)
  return fs.readFileSync(path.join(__dirname, 'certs', basename))
}

export function httpsServer(defaultPort: number): any {
  const key = ensureFile(path.join(__dirname, 'certs', 'localhost.key'))
  const cert = ensureFile(path.join(__dirname, 'certs', 'localhost.cert'))

  // If certs are missing, fall back to HTTP server (development convenience)
  if (!key || !cert) {
    try {
      console.log(messages.certRequired())
    } catch {}
    return httpServer(defaultPort)
  }

  const options = {key, cert}

  const server = https.createServer(options, (_req, res) => {
    res.writeHead(200)
    res.end()
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(messages.defaultPortInUse(defaultPort))
    throw new Error(err.message)
  })

  try {
    server.listen(defaultPort, '127.0.0.1')
  } catch {}
  return {server, port: defaultPort}
}

export function httpServer(defaultPort: number): any {
  const server = http.createServer((_req, res) => {
    res.writeHead(200)
    res.end()
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(messages.defaultPortInUse(defaultPort))
    throw new Error(err.message)
  })

  try {
    server.listen(defaultPort, '127.0.0.1')
  } catch {}
  return {server, port: defaultPort}
}
