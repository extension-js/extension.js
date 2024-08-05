import path from 'path'
import WebSocket from 'ws'
import {type Compiler} from 'webpack'
import * as messages from '../../../../lib/messages'
import {type Manifest} from '../../../../webpack-types'
import {isFirstRun} from '../../../../lib/utils'
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
  const projectPath = compiler.options.context || ''
  const manifest = require(path.join(projectPath, 'manifest.json'))
  const manifestName = manifest.name || 'Extension.js'

  const webSocketServer = new WebSocket.Server({
    host: 'localhost',
    port: options.port
  })
  webSocketServer.on('connection', (ws) => {
    ws.send(JSON.stringify({status: 'serverReady'}))

    ws.on('error', (error) => {
      console.log(messages.webSocketError(manifestName, error))
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
        const manifest: Manifest = require(
          path.join(projectPath, 'manifest.json')
        )
        console.log(messages.runningInDevelopment(manifest, options, message))
        console.log('')
        console.log(
          messages.stdoutData(
            options.mode,
            options.browser,
            message.data?.management.enabled || false
          )
        )

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
