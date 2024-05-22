import path from 'path'
import https from 'https'
import fs from 'fs'
import {bold, bgWhite, red} from '@colors/colors/safe'

export default function httpsServer(defaultPort = 8002) {
  const options = {
    key: fs.readFileSync(path.join(__dirname, 'certs', 'localhost.key')),
    cert: fs.readFileSync(path.join(__dirname, 'certs', 'localhost.cert'))
  }

  const server = https.createServer(options, (req, res) => {
    res.writeHead(200)
  })

  server.listen(defaultPort, '127.0.0.1')

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[😓] ${bgWhite(red(bold(` firefox-browser `)))} ${red(
          '✖︎✖︎✖︎'
        )} Default port ${defaultPort} in use, choose a new port. + '\n'
        }Exiting...\n`
      )
    }

    throw new Error(err.message)
  })

  return server
}
