import fs from 'fs'
import path from 'path'
import {validate} from 'schema-utils'
import {type Schema} from 'schema-utils/declarations/validate'
import {type LoaderContext} from '../../../../../webpack-types'

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
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))

  validate(schema, options, {
    name: 'scripts:warn-no-default-export',
    baseDataPath: 'options'
  })

  // Warn when a content script module lacks a default export
  try {
    const resourceAbsPath = path.normalize(this.resourcePath)
    const projectPath = path.dirname(manifestPath)

    const declaredContentJsAbsPaths: string[] = []
    const contentScripts = Array.isArray(manifest.content_scripts)
      ? manifest.content_scripts
      : []

    for (const cs of contentScripts) {
      const jsList = Array.isArray(cs?.js) ? cs.js : []
      for (const js of jsList) {
        declaredContentJsAbsPaths.push(path.resolve(projectPath, js as string))
      }
    }

    const isDeclaredContentScript = declaredContentJsAbsPaths.some(
      (abs) => resourceAbsPath === path.normalize(abs)
    )

    if (isDeclaredContentScript) {
      // Heuristic: warn if module text does not include a default export
      // (We avoid parsing to keep loader lightweight)
      const hasDefault = /export\s+default\s+/m.test(source)
      if (!hasDefault) {
        const relativeFile = path.relative(projectPath, resourceAbsPath)
        const message = [
          'Content script missing default export.',
          `File: ${relativeFile}`,
          '',
          'Why: The hot-reload (HMR) wrapper for content scripts expects a default export to attach to.',
          'Fix:',
          '  - Export a default function from your content script, for example:',
          '      export default function main() {\n        // setup code...\n      }\n'
        ].join('\n')

        ;(this as any).emitWarning?.(new Error(message))
      }
    }
  } catch {}

  return source
}
