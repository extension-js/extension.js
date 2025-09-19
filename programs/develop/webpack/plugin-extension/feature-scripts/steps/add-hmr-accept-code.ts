import fs from 'fs'
import path from 'path'
import {urlToRequest} from 'loader-utils'
import {validate} from 'schema-utils'
import {type Schema} from 'schema-utils/declarations/validate'
import {type LoaderContext} from '../../../webpack-types'

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
    },
    mode: {
      type: 'string'
    }
  }
}

export default function (this: LoaderContext, source: string) {
  const options = this.getOptions()
  const manifestPath = options.manifestPath
  const projectPath = path.dirname(manifestPath)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))

  validate(schema, options, {
    name: 'scripts:add-hmr-accept-code',
    baseDataPath: 'options'
  })

  // If HMR accept code is already present
  // (injected by a framework wrapper), skip to avoid duplication
  if (source.includes('import.meta.webpackHot')) {
    return source
  }

  const url = urlToRequest(this.resourcePath)
  const reloadCodeContent = `
// Extension.js HMR registration (injected)
if (import.meta.webpackHot) {
  try {
    import.meta.webpackHot.accept();
    import.meta.webpackHot.dispose(() => {
      try {
        if (typeof document !== 'undefined') {
          const knownRoots = ['#extension-root','[data-extension-root="true"]'];
          for (const selector of knownRoots) {
            const el = document.querySelector(selector as any) as any;
            if (el && (el as any).parentElement) { (el as any).parentElement.removeChild(el as any); }
          }
        }
      } catch (_) {}
    });
  } catch (_) {}
}
  `

  const reloadCodeBackground = `
// Extension.js HMR registration (injected)
if (import.meta.webpackHot) { try { import.meta.webpackHot.accept(); } catch (_) {} }
  `

  // 1 - Handle background.scripts.
  // We don't add this to service_worker because it's reloaded by
  // chrome.runtime.reload() and not by HMR.
  if (manifest.background) {
    if (manifest.background.scripts) {
      for (const bgScript of manifest.background.scripts) {
        const absoluteUrl = path.resolve(projectPath, bgScript as string)
        if (url.includes(absoluteUrl)) {
          return `${reloadCodeBackground}${source}`
        }
      }
    }
  }

  // 2 - Handle content_scripts.
  if (manifest.content_scripts) {
    // Always add HMR acceptance to content scripts for proper HMR functionality
    for (const contentScript of manifest.content_scripts) {
      if (!contentScript.js) continue
      for (const js of contentScript.js) {
        const absoluteUrl = path.resolve(projectPath, js as string)
        if (url.includes(absoluteUrl)) {
          return `${reloadCodeContent}${source}`
        }
      }
    }
  }

  // 3 - Handle user_scripts.
  if (manifest.user_scripts) {
    for (const userScript of manifest.user_scripts) {
      const absoluteUrl = path.resolve(projectPath, userScript as string)
      if (url.includes(absoluteUrl)) {
        return `${reloadCodeBackground}${source}`
      }
    }
  }

  return source
}
