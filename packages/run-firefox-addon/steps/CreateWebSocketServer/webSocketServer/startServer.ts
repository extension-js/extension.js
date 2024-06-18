import path from 'path'
import WebSocket from 'ws'
import {type Compiler} from 'webpack'
import type browser from 'webextension-polyfill-ts'
import httpsServer from './httpsServer'
import messages from '../../../helpers/messages'
import {type RunFirefoxExtensionInterface} from '../../../types'
import {type ManifestBase} from '../../../manifest-types'
import isFirstRun from '../../RunFirefoxPlugin/firefox/isFirstRun'

function getHardcodedMessage(manifest: ManifestBase) {
  const manifestName = manifest.name.replace(/ /g, '-').toLowerCase()

  return {
    data: {
      id: `${manifestName}@extension-js`,
      manifest,
      management: {
        id: `${manifestName}@extension-js`,
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
        const isUserFirstRun = isFirstRun()

        if (options.stats === true) {
          const projectDir = compiler.options.context || ''
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          messages.extensionData(projectDir, message)
        }

        messages.stdoutData(compiler, message)

        if (options.stats === true) {
          if (isUserFirstRun) {
            messages.isFirstRun()
          }
        }
      }
    })
  })

  // Set a timeout to send the hardcoded message if no other message is received
  const context = compiler.options.context || ''
  const manifestPath = path.join(context, 'manifest.json')
  const manifest: ManifestBase = require(manifestPath)

  const hardcodedMessageTimeout = setTimeout(() => {
    const hardcodedMessage = getHardcodedMessage(manifest)

    if (options.stats === true) {
      messages.extensionData(context, hardcodedMessage)
    }

    messages.stdoutData(compiler, hardcodedMessage)

    if (options.stats === true) {
      messages.certRequired()
    }
  }, 10000)

  return webSocketServer
}
