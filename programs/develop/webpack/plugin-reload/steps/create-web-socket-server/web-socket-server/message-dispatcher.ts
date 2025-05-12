import path from 'path'
import WebSocket, {Server} from 'ws'
import {getManifestFieldsData} from '../../../../plugin-extension/data/manifest-fields'

function dispatchMessage(
  server: Server<typeof WebSocket, any>,
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

export function messageDispatcher(
  server: Server<typeof WebSocket, any> | undefined,
  manifestPath: string,
  updatedFile: string
) {
  if (!updatedFile || !manifestPath) return

  const manifestLocales = getManifestFieldsData({manifestPath}).locales
  const manifestScripts = getManifestFieldsData({manifestPath}).scripts
  const jsonScripts = getManifestFieldsData({manifestPath}).json

  if (!server) {
    if (process.env.EXTENSION_ENV === 'development') {
      console.error('WebSocket server is not running.')
    }

    return
  }

  if (path.basename(updatedFile) === 'manifest.json') {
    // Ensure the manifest itself is watched.
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
