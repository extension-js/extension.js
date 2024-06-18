import path from 'path'
import WebSocket from 'ws'
import {type Compiler} from 'webpack'
import messages from '../../../helpers/messages'
import {type RunFirefoxExtensionInterface} from '../../../types'
import {type ManifestBase} from '../../../manifest-types'
import httpsServer from './httpsServer'

import isFirstRun from '../../RunFirefoxPlugin/firefox/isFirstRun'
import type browser from 'webextension-polyfill-ts'

function getHardcodedMessage(manifest: ManifestBase) {
  return {
    data: {
      id: manifest.browser_specific_settings?.gecko?.id,
      manifest,
      management: {
        id: manifest.browser_specific_settings?.gecko?.id,
        mayDisable: true,
        optionsUrl: '',
        installType: 'development' as 'development',
        type: 'extension' as 'extension',
        enabled: true,
        name: manifest.name,
        description: manifest.description || '',
        version: manifest.version,
        hostPermissions: manifest.host_permissions,
        permissions: manifest.permissions
      }
    }
  }
}

interface Data {
  id: string
  manifest: ManifestBase
  management: browser.Management.ExtensionInfo
}

interface Message {
  data?: Data | undefined
  status: string
}

export default function (
  compiler: Compiler,
  options: RunFirefoxExtensionInterface
) {
  const webSocketServer = new WebSocket.Server({
    server: httpsServer(options.port)
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
      // Clear the timeout to prevent the hardcoded message from being sent
      clearTimeout(hardcodedMessageTimeout)

      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const message: Message = JSON.parse(msg.toString())

      if (message.status === 'clientReady') {
        if (options.stats === true) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          messages.extensionData(compiler, message, isUserFirstRun)
        }

        messages.stdoutData(compiler, message)

        if (options.stats === true) {
          if (isUserFirstRun) {
            messages.isFirstRun()
          }
        }
        return
      }

      const outputPath = compiler.options.output?.path || 'dist'
      const manifestPath = path.join(outputPath, 'manifest.json')
      const manifest = require(manifestPath)

      // The initial stdout of this plugin where the extension info is provided
      // is handled by the reload service. However Firefox requires a secure connection
      // to authorize the websocket message passing. In this case, show a hardcoded
      // message with the extension data for the first run, and inform users that they
      // can run a command like `npx mkcert-cli` to create a certificate for the extension.
      const hardcodedMessage = getHardcodedMessage(manifest)

      if (options.stats === true) {
        messages.extensionData(compiler, hardcodedMessage, true)
      }

      messages.stdoutData(compiler, hardcodedMessage)
    })

  })

  // Set a timeout to send the hardcoded message if no other message is received
  const hardcodedMessageTimeout = setTimeout(() => {
    const outputPath = compiler.options.output?.path || 'dist'
    const manifestPath = path.join(outputPath, 'manifest.json')
    const manifest = require(manifestPath)
    const hardcodedMessage = getHardcodedMessage(manifest)

    if (options.stats === true) {
      messages.extensionData(compiler, hardcodedMessage, true)
    }

    messages.stdoutData(compiler, hardcodedMessage)

    if (options.stats === true) {
      messages.certRequired()
    }
  }, 10000)

  return webSocketServer
}
