import path from 'path'
import http from 'http'
import https from 'https'
import fs from 'fs'

import * as messages from '../../../../lib/messages'

const ensureFile = (filePath: string) => {
  if (!fs.existsSync(filePath)) {
    return undefined
  }

  const basename = path.basename(filePath)
  return fs.readFileSync(path.join(__dirname, 'certs', basename))
}

export function httpsServer(manifestName: string, defaultPort: number) {
  const options = {
    key: ensureFile(path.join(__dirname, 'certs', 'localhost.key')),
    cert: ensureFile(path.join(__dirname, 'certs', 'localhost.cert'))
  }

  const server = https.createServer(options, (_req, res) => {
    res.writeHead(200)
    res.end()
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(messages.defaultPortInUse(manifestName, defaultPort))
    throw new Error(err.message)
  })

  return {server, port: defaultPort}
}

export function httpServer(manifestName: string, defaultPort: number) {
  const server = http.createServer((_req, res) => {
    res.writeHead(200)
    res.end()
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(messages.defaultPortInUse(manifestName, defaultPort))
    throw new Error(err.message)
  })

  return {server, port: defaultPort}
}
