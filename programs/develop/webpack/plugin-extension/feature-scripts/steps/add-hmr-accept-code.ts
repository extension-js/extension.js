import fs from 'fs'
import path from 'path'
import {urlToRequest} from 'loader-utils'
import {validate} from 'schema-utils'
import {type Schema} from 'schema-utils/declarations/validate'
import {type LoaderContext} from '../../../webpack-types'
import * as messages from '../../../lib/messages'

function whichFramework(projectPath: string): string | null {
  const packageJsonPath = path.join(projectPath, 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
  const frameworks = [
    'react',
    'vue',
    '@angular/core',
    'svelte',
    'solid-js',
    'preact'
  ]

  for (const framework of frameworks) {
    if (
      packageJson.dependencies[framework] ||
      packageJson.devDependencies[framework]
    ) {
      return framework
    }
  }

  return null
}

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
  const standardReloadCode = `
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
          return `${standardReloadCode}${source}`
        }
      }
    }
  }

  // 2 - Handle content_scripts.
  if (manifest.content_scripts) {
    for (const contentScript of manifest.content_scripts) {
      if (!contentScript.js) continue

      for (const js of contentScript.js) {
        const absoluteUrl = path.resolve(projectPath, js as string)

        if (url.includes(absoluteUrl)) {
          if (source.includes('__EXTENSION_SHADOW_ROOT__')) {
            console.warn(messages.deprecatedShadowRoot())
          }

          if (isUsingJSFramework(projectPath)) {
            const framework = whichFramework(projectPath)

            if (source.includes('use shadow-dom')) {
              switch (framework) {
                // case 'react':
                //   return `${standardReloadCode}${source}`
                default:
                  return `${standardReloadCode}${source}`
              }
            }

            return `${source}`
          }

          return `${standardReloadCode}${source}`
        }
      }
    }
  }

  // 3 - Handle user_scripts.
  if (manifest.user_scripts) {
    for (const userScript of manifest.user_scripts) {
      const absoluteUrl = path.resolve(projectPath, userScript as string)
      if (url.includes(absoluteUrl)) {
        return `${standardReloadCode}${source}`
      }
    }
  }

  return source
}
