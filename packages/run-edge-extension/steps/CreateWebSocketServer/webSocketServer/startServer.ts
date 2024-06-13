import WebSocket from 'ws'
import {type Compiler} from 'webpack'
import messages from '../../../helpers/messages'
import {type StatsPreset} from '../../../types'
import {type ManifestBase} from '../../../manifest-types'
import isFirstRun from '../../RunEdgePlugin/edge/isFirstRun'

interface Data {
  id: string
  manifest: ManifestBase
  management: chrome.management.ExtensionInfo
}

interface Message {
  data?: Data | undefined
  status: string
}

export default function (
  compiler: Compiler,
  statsConfig: StatsPreset | undefined,
  port?: number
) {
  const webSocketServer = new WebSocket.Server({
    host: 'localhost',
    port
  })
  const isUserFirstRun = isFirstRun()

  webSocketServer.on('connection', (ws) => {
    ws.send(JSON.stringify({status: 'serverReady'}))

    ws.on('error', (error) => {
      messages.webSocketError(error)
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
          messages.extensionData(compiler, message, isUserFirstRun)
        }

        messages.stdoutData(compiler, message)

        if (statsConfig === true) {
          if (isUserFirstRun) {
            // Add a delay to ensure the message is sent
            // after other runner messages.
            setTimeout(() => {
              messages.isFirstRun()
            }, 2500)
          }
        }
      }
    })
  })

  return webSocketServer
}
