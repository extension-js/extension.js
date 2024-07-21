import WebSocket from 'ws'
import {type Compiler} from 'webpack'
import * as messages from '../../../reload-lib/messages'
import {type Manifest} from '../../../../types'
import {isFirstRun} from '../../../reload-lib/is-first-run'

interface Data {
  id: string
  manifest: Manifest
  management: chrome.management.ExtensionInfo
}

interface Message {
  data?: Data | undefined
  status: string
}

export default function (
  compiler: Compiler,
  browser: string,
  statsConfig: boolean | undefined,
  port?: number
) {
  const webSocketServer = new WebSocket.Server({
    host: 'localhost',
    port
  })
  webSocketServer.on('connection', (ws) => {
    ws.send(JSON.stringify({status: 'serverReady'}))

    ws.on('error', (error) => {
      console.log(messages.webSocketError(error))
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
        if (statsConfig === true) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          console.log(messages.extensionData(compiler, browser, message))
        }

        console.log(messages.stdoutData(compiler, browser, message))

        if (statsConfig === true) {
          if (isFirstRun(browser)) {
            // Add a delay to ensure the message is sent
            // after other runner messages.
            setTimeout(() => {
              console.log(messages.isFirstRun())
            }, 2500)
          }
        }
      }
    })
  })

  return webSocketServer
}
