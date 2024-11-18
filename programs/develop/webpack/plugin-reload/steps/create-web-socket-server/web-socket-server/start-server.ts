import path from 'path'
import fs from 'fs'
import WebSocket from 'ws'
import {Compiler} from 'webpack'
import * as messages from '../../../../lib/messages'
import {type Manifest} from '../../../../webpack-types'
import {getHardcodedMessage, isFirstRun} from '../../../../lib/utils'
import {DevOptions} from '../../../../../module'
import {CERTIFICATE_DESTINATION_PATH} from '../../../../lib/constants'
import {httpsServer} from './servers'

interface Data {
  id: string
  manifest: Manifest
  management: chrome.management.ExtensionInfo
}

interface Message {
  data?: Data | undefined
  status: string
}

function setupServer(port: number, browser: DevOptions['browser']) {
  switch (browser) {
    case 'chrome':
      return new WebSocket.Server({
        host: 'localhost',
        port
      })

    case 'edge':
      return new WebSocket.Server({
        host: 'localhost',
        port: port + 1
      })

    case 'firefox':
      return new WebSocket.Server({
        server: httpsServer(port + 2).server
      })

    default:
      return new WebSocket.Server({
        host: 'localhost',
        port: 8888
      })
  }
}

export async function startServer(compiler: Compiler, options: DevOptions) {
  const projectPath = compiler.options.context || ''
  const manifest = require(path.join(projectPath, 'manifest.json'))
  const port = 8000
  const webSocketServer = setupServer(port, options.browser)

  webSocketServer.on('connection', (ws) => {
    ws.send(JSON.stringify({status: 'serverReady'}))

    ws.on('error', (error) => {
      console.log(messages.webSocketError(error))
    })

    ws.on('message', (msg) => {
      const message: Message = JSON.parse(msg.toString())

      if (message.status === 'clientReady') {
        const manifest: Manifest = require(
          path.join(projectPath, 'manifest.json')
        )

        setTimeout(() => {
          console.log(
            messages.runningInDevelopment(manifest, options.browser, message)
          )
          console.log('')
        }, 2500)

        if (isFirstRun(options.browser)) {
          setTimeout(() => {
            console.log(messages.isFirstRun(options.browser))
          }, 5000)
        }
      }
    })
  })

  // Additional logic specific to Firefox, such as certificate checks
  if (options.browser === 'firefox' || options.browser === 'gecko-based') {
    const hardcodedMessage = getHardcodedMessage(manifest)
    console.log(
      messages.runningInDevelopment(manifest, options.browser, hardcodedMessage)
    )
    console.log('')

    if (!fs.existsSync(CERTIFICATE_DESTINATION_PATH)) {
      console.log(messages.certRequired())
      console.log('')
    }
  }

  return webSocketServer
}
