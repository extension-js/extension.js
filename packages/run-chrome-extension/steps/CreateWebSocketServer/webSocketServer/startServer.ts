import WebSocket from 'ws'
import {type Compiler} from 'webpack'
import messages from '../../../helpers/messages'
import {type StatsPreset} from '../../../types'
import {type ManifestBase} from '../../../manifest-types'
import isFirstRun from '../../RunChromePlugin/chrome/isFirstRun'

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

    ws.on('close', (code, reason) => {
      // TODO: cezaraugusto there is some sort of bug that closes the
      // WebSocket connection and the process exits with code 1001.
      // This error breaks the watch mode and the user has to restart
      // the process. This is a temporary fix to avoid the error message.
      // The fix so far is to run the process again.
      if (!isUserFirstRun) {
        messages.watchModeClosed(code, reason)
      }

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
