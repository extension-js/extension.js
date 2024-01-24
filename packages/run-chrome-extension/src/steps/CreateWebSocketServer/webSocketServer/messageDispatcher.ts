import path from 'path'
import WebSocket from 'ws'
import manifestFields, {getPagesPath} from 'browser-extension-manifest-fields'
import {type RunChromeExtensionInterface} from '../../../../types'

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

  const pagesPath = options.pagesFolder
    ? path.resolve(path.dirname(options.manifestPath), options.pagesFolder)
    : undefined

  const allHtml = {
    ...manifestFields(options.manifestPath!).html,
    ...(pagesPath ? getPagesPath(pagesPath) : {})
  }
  const manifestLocales = manifestFields(options.manifestPath!).locales
  const manifestScripts = manifestFields(options.manifestPath!).scripts

  // Ensure the manifest itself is watched.
  if (path.basename(updatedFile) === 'manifest.json') {
    dispatchMessage(server, {
      changedFile: 'manifest.json'
    })
  }

  // Handle HTML files
  Object.entries(allHtml).forEach(([, entryData]) => {
    if (entryData?.html === updatedFile) {
      dispatchMessage(server, {
        changedFile: 'html'
      })
    }
  })

  // Handle _locales files
  manifestLocales.forEach((path) => {
    if (path.includes(updatedFile)) {
      dispatchMessage(server, {
        changedFile: 'locale'
      })
    }
  })

  // Handle background/content/user scripts.
  Object.entries(manifestScripts).forEach(([entryName, entryData]) => {
    const entryDataArr = Array.isArray(entryData) ? entryData : [entryData]
    const entryFiles = Object.values(entryDataArr).flatMap((arr) => arr)

    if (entryFiles.includes(updatedFile)) {
      if (entryName === 'service_worker') {
        dispatchMessage(server, {
          changedFile: 'service_worker'
        })
      }
    }
  })
}
