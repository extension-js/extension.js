import path from 'path'
import WebSocket from 'ws'
import manifestFields from 'browser-extension-manifest-fields'
import {type RunChromeExtensionInterface} from '../../../types'

function dispatchMessage(
  server: WebSocket.Server<typeof WebSocket, any>,
  message: {
    status: string
    where: string
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
  if (!updatedFile) return

  const manifestLocales = manifestFields(options.manifestPath!).locales
  const manifestScripts = manifestFields(options.manifestPath!).scripts
  const manifestHtml = manifestFields(options.manifestPath!).html

  // Ensure the manifest itself is watched.
  if (path.basename(updatedFile) === 'manifest.json') {
    dispatchMessage(server, {
      status: 'reload',
      where: 'manifest'
    })
  }

  // Handle _locales files
  manifestLocales.forEach((path) => {
    if (path.includes(updatedFile)) {
      dispatchMessage(server, {
        status: 'reload',
        where: 'locale'
      })
    }
  })

  // Reload strategy for background/content/user scripts.
  // The options below applies to both autoReload: true and autoReload: 'background'.
  // This file is never read if autoReload: false.
  Object.entries(manifestScripts).forEach(([entryName, entryData]) => {
    const entryDataArr = Array.isArray(entryData) ? entryData : [entryData]
    const entryFiles = Object.values(entryDataArr).flatMap((arr) => arr)

    if (entryFiles.includes(updatedFile)) {
      if (
        // Handle background.scripts for v2
        // and background.service_worker for v3
        entryName === 'background' ||
        // Content script CSS files.
        // Content scripts JS files.
        entryName.startsWith('content')
      ) {
        dispatchMessage(server, {
          status: 'reload',
          where: 'background'
        })
      }
    }
  })

  // The options below applies only to autoReload: true.
  if (options.autoReload && options.autoReload !== 'background') {
    Object.entries(manifestHtml).forEach(([_entryName, entryData]) => {
      // Handle HTML files
      if (entryData?.html.includes(updatedFile)) {
        dispatchMessage(server, {
          status: 'reload',
          where: 'html'
        })
      }

      // Handle JS files inside HTML files
      if (entryData?.js.length) {
        entryData.js.forEach((path) => {
          if (path.includes(updatedFile)) {
            dispatchMessage(server, {
              status: 'reload',
              where: 'html'
            })
          }
        })
      }

      // Handle CSS files inside HTML files
      if (entryData?.css.length) {
        entryData.css.forEach((path) => {
          if (path.includes(updatedFile)) {
            dispatchMessage(server, {
              status: 'reload',
              where: 'html'
            })
          }
        })
      }
    })
  }
}
