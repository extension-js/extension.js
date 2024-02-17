import WebSocket from 'ws'
import {type Compiler} from 'webpack'
import messages from '../../../helpers/messages'
import {StatsPreset} from '../../../types'
import isFirstRun from '../../RunChromePlugin/chrome/isFirstRun'

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
      const message = JSON.parse(msg.toString())

      if (message.status === 'clientReady') {
        if (statsConfig === true) {
          messages.extensionData(compiler, message, isUserFirstRun)
        }
      }
    })
  })

  return webSocketServer
}
