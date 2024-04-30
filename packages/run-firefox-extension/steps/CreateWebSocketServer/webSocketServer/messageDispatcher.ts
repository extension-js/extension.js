import path from 'path'
import WebSocket from 'ws'
import manifestFields from 'browser-extension-manifest-fields'
import {type RunChromeExtensionInterface} from '../../../types'

function dispatchMessage(
  server: WebSocket.Server<typeof WebSocket, any>,
  message: {
    changedFile: string
  }
) {
  server.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message))
    }
  })
}

export default function messageDispatcher(
  server: WebSocket.Server<typeof WebSocket, any>,
  options: RunChromeExtensionInterface,
  updatedFile: string
) {
  if (!updatedFile || !options.manifestPath) return

  const manifestLocales = manifestFields(options.manifestPath).locales
  const manifestScripts = manifestFields(options.manifestPath).scripts
  const jsonScripts = manifestFields(options.manifestPath).json

  // Ensure the manifest itself is watched.
  if (path.basename(updatedFile) === 'manifest.json') {
    dispatchMessage(server, {
      changedFile: 'manifest.json'
    })
  }

  // Handle _locales files
  manifestLocales?.forEach((path) => {
    if (path.includes(updatedFile)) {
      dispatchMessage(server, {
        changedFile: '_locales'
      })
    }
  })

  // Handle service_worker scripts.
  Object.entries(manifestScripts).forEach(([entryName, entryData]) => {
    const entryDataArr = Array.isArray(entryData) ? entryData : [entryData]
    const entryFiles = Object.values(entryDataArr).flatMap((arr) => arr)

    if (entryFiles.includes(updatedFile)) {
      if (entryName === 'background/service_worker') {
        dispatchMessage(server, {
          changedFile: 'service_worker'
        })
      }
    }
  })

  // Handle JSON files
  Object.entries(jsonScripts).forEach(([entryName, entryData]) => {
    if (entryData?.includes(updatedFile)) {
      if (entryName === 'declarative_net_request') {
        dispatchMessage(server, {
          changedFile: 'declarative_net_request'
        })
      }
    }
  })
}
