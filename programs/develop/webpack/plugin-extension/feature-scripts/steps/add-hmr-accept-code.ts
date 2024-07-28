import fs from 'fs'
import path from 'path'
import {urlToRequest} from 'loader-utils'
import {validate} from 'schema-utils'
import {type Schema} from 'schema-utils/declarations/validate'
import {type LoaderContext} from '../../../types'

function isUsingJSFramework(projectPath: string): boolean {
  const packageJsonPath = path.join(projectPath, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))

  const frameworks = [
    'react',
    'vue',
    '@angular/core',
    'svelte',
    'solid-js',
    'preact'
  ]

  const dependencies = packageJson.dependencies || {}
  const devDependencies = packageJson.devDependencies || {}

  for (const framework of frameworks) {
    if (dependencies[framework] || devDependencies[framework]) {
      return true
    }
  }

  return false
}

const schema: Schema = {
  type: 'object',
  properties: {
    test: {
      type: 'string'
    },
    manifestPath: {
      type: 'string'
    }
  }
}

export default function (this: LoaderContext, source: string) {
  const options = this.getOptions()
  const manifestPath = options.manifestPath
  const projectPath = path.dirname(manifestPath)
  const manifest = require(manifestPath)

  validate(schema, options, {
    name: 'scripts:add-hmr-accept-code',
    baseDataPath: 'options'
  })

  // @ts-expect-error this is not typed
  if (this._compilation?.options.mode === 'production') return source

  const url = urlToRequest(this.resourcePath)
  const reloadCode = `
if (import.meta.webpackHot) { import.meta.webpackHot.accept() };
  `

  // 1 - Handle background.scripts.
  // We don't add this to service_worker because it's reloaded by
  // chrome.runtime.reload() and not by HMR.
  if (manifest.background) {
    if (manifest.background.scripts) {
      for (const bgScript of manifest.background.scripts) {
        const absoluteUrl = path.resolve(projectPath, bgScript as string)
        if (url.includes(absoluteUrl)) {
          return `${reloadCode}${source}`
        }
      }
    }
  }

  // 2 - Handle content_scripts.
  if (manifest.content_scripts) {
    // If React exists, let the react reload logic handle the reload.
    // WARN: Removing this check will cause the content script to pile up
    // in the browser. This is something related to the react reload plugin
    // or the webpack-target-webextension plugin.
    // TODO: cezaraugusto because of this, entry files of content_scripts
    // written in JSX doesn't reload. This is a bug.
    if (!isUsingJSFramework(projectPath)) {
      for (const contentScript of manifest.content_scripts) {
        if (!contentScript.js) continue
        for (const js of contentScript.js) {
          const absoluteUrl = path.resolve(projectPath, js as string)
          if (url.includes(absoluteUrl)) {
            return `${reloadCode}${source}`
          }
        }
      }
    }
  }

  // 3 - Handle user_scripts.
  if (manifest.user_scripts) {
    for (const userScript of manifest.user_scripts) {
      const absoluteUrl = path.resolve(projectPath, userScript as string)
      if (url.includes(absoluteUrl)) {
        return `${reloadCode}${source}`
      }
    }
  }

  return source
}
