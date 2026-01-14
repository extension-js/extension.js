// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

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

  // Skip the synthetic "inner" request to avoid double-processing.
  // The wrapper triggers a second pass with ?__extjs_inner=1.
  const resourceQuery = (this as any).resourceQuery as string | undefined

  if (
    typeof resourceQuery === 'string' &&
    resourceQuery.includes('__extjs_inner=1')
  ) {
    return source
  }

  validate(schema, options, {
    name: 'scripts:warn-no-default-export',
    baseDataPath: 'options'
  })

  // Warn when a content script module lacks a default export
  try {
    const resourceAbsPath = path.normalize(this.resourcePath)
    const projectPath = path.dirname(manifestPath)
    const compilation: any = (this as any)._compilation

    // Deduplicate warnings per compilation per file
    const dedupeKey = `no-default:${resourceAbsPath}`
    if (compilation) {
      compilation.__extjsWarnedDefaultExport ??= new Set<string>()
      if (compilation.__extjsWarnedDefaultExport.has(dedupeKey)) {
        return source
      }
    }

    const declaredContentJsAbsPaths: string[] = []
    const contentScripts = Array.isArray(manifest.content_scripts)
      ? manifest.content_scripts
      : []

    for (const contentScript of contentScripts) {
      const contentScriptJsList = Array.isArray(contentScript?.js)
        ? contentScript.js
        : []

      for (const contentScriptJs of contentScriptJsList) {
        declaredContentJsAbsPaths.push(
          path.resolve(projectPath, contentScriptJs as string)
        )
      }
    }

    const isDeclaredContentScript = declaredContentJsAbsPaths.some(
      (abs) => resourceAbsPath === path.normalize(abs)
    )

    const scriptsDir = path.resolve(projectPath, 'scripts')
    const relToScripts = path.relative(scriptsDir, resourceAbsPath)
    const isScriptsFolderScript =
      relToScripts &&
      !relToScripts.startsWith('..') &&
      !path.isAbsolute(relToScripts)

    const isContentScriptLike = isDeclaredContentScript || isScriptsFolderScript

    if (isContentScriptLike) {
      // Heuristic: warn if module text does not include a default export
      // (We avoid parsing to keep loader lightweight)
      const hasDefault = /export\s+default\s+/m.test(source)
      if (!hasDefault) {
        const relativeFile = path.relative(projectPath, resourceAbsPath)
        const message = [
          'Content script requires a default export.',
          `File: ${relativeFile}`,
          ``,
          `Why:`,
          `  - During development, Extension.js uses your default export to start and stop your content script safely.`,
          `  - Without it, automatic reloads and cleanup might not work reliably.`,
          ``,
          `Required:`,
          `  - Export a default function (it can optionally return a cleanup callback).`,
          ``,
          `Example:`,
          `  export default function main() {`,
          `    // setup...`,
          `    return () => { /* cleanup */ }`,
          `  }`,
          ``,
          `Side effects if omitted:`,
          `  - Duplicate UI mounts, memory leaks, and inconsistent state during development.`
        ].join('\n')

        // Prefer a compilation-level warning to avoid the noisy "Module Warning (from loader)" prefix.
        // Push as a string so the header becomes: "WARNING in Content script requires a default export."
        compilation?.warnings.push(message)
        compilation?.__extjsWarnedDefaultExport?.add(dedupeKey)
      }
    }
  } catch {
    //Ignore errors
  }

  return source
}
