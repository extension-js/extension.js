import path from 'path'
import WebSocket from 'ws'
import {type Compiler} from 'webpack'
import * as messages from '../../../reload-lib/messages'
import {type Manifest} from '../../../../webpack-types'
import {isFirstRun} from '../../../reload-lib/is-first-run'
import {DevOptions} from '../../../../../module'

interface Data {
  id: string
  manifest: Manifest
  management: chrome.management.ExtensionInfo
}

interface Message {
  data?: Data | undefined
  status: string
}

export function startServer(compiler: Compiler, options: DevOptions) {
  const context = compiler.options.context || ''
  const packageJsonPath = path.join(context, 'package.json')
  const packageJson = require(packageJsonPath)
  const packageName = packageJson.name

  const webSocketServer = new WebSocket.Server({
    host: 'localhost',
    port: options.port
  })
  webSocketServer.on('connection', (ws) => {
    ws.send(JSON.stringify({status: 'serverReady'}))

    ws.on('error', (error) => {
      console.log(messages.webSocketError(packageName, error))
      webSocketServer.close()
    })

    ws.on('close', () => {
      webSocketServer.close()
    })

    // We're only ready when the extension says so
    ws.on('message', (msg) => {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const message: Message = JSON.parse(msg.toString())

      if (message.status === 'clientReady') {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        console.log(messages.extensionData(compiler, packageName, message))

        console.log(messages.stdoutData(compiler, options.browser))

        if (isFirstRun(options.browser)) {
          // Add a delay to ensure the message is sent
          // after other runner messages.
          setTimeout(() => {
            console.log(messages.isFirstRun(options.browser))
          }, 2500)
        }
      }
    })
  })

  return webSocketServer
}
