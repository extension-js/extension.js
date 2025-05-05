import path from 'path'
import http from 'http'
import https from 'https'
import fs from 'fs'
import {getDirname} from '../../../../../dirname'
import * as messages from '../../../../lib/messages'

const __dirname = getDirname(import.meta.url)

const ensureFile = (filePath: string) => {
  if (!fs.existsSync(filePath)) {
    return undefined
  }

  const basename = path.basename(filePath)
  return fs.readFileSync(path.join(__dirname, 'certs', basename))
}

export function httpsServer(defaultPort: number): any {
  const options = {
    key: ensureFile(path.join(__dirname, 'certs', 'localhost.key')),
    cert: ensureFile(path.join(__dirname, 'certs', 'localhost.cert'))
  }

  const server = https.createServer(options, (_req, res) => {
    res.writeHead(200)
    res.end()
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(messages.defaultPortInUse(defaultPort))
    throw new Error(err.message)
  })

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

  return {server, port: defaultPort}
}
