import path from 'path'
import https from 'https'
import fs from 'fs'
import {bold, bgWhite, red} from '@colors/colors/safe'

const ensureFile = (filePath: string) => {
  if (!fs.existsSync(filePath)) {
    return undefined
  }

  const basename = path.basename(filePath)
  return fs.readFileSync(path.join(__dirname, 'certs', basename))
}

export default function httpsServer(defaultPort = 8002) {
  const options = {
    key: ensureFile(path.join(__dirname, 'certs', 'localhost.key')),
    cert: ensureFile(path.join(__dirname, 'certs', 'localhost.cert'))
  }

  const server = https.createServer(options, (req, res) => {
    res.writeHead(200)
  })

  server.listen(defaultPort, '127.0.0.1')

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[😓] ${bgWhite(red(` firefox-browser `))} ${red(
          '✖︎✖︎✖︎'
        )} Default port ${defaultPort} in use, choose a new port. + '\n'
        }Exiting...\n`
      )
    }

    throw new Error(err.message)
  })

  return server
}
