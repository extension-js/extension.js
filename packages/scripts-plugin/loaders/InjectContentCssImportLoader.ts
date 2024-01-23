import path from 'path'
import {urlToRequest} from 'loader-utils'
import {validate} from 'schema-utils'
import manifestFields from 'browser-extension-manifest-fields'
import {type LoaderContext} from 'webpack'
import {type Schema} from 'schema-utils/declarations/validate'
import {getFilepath} from '../src/helpers/getResourceName'

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

interface InjectContentCssImportContext extends LoaderContext<any> {
  getOptions: () => {
    manifestPath: string
  }
}

function getCssEntriesToImport(manifestPath: string, absoluteUrl: string) {
  const scriptFields = manifestFields(manifestPath).scripts

  const cssEntries = []

  for (const field of Object.entries(scriptFields)) {
    const [feature, scriptFilePath] = field

    if (feature.startsWith('content_scripts')) {
      const scripts = Array.isArray(scriptFilePath)
        ? scriptFilePath
        : [scriptFilePath]

      if (scripts.length) {
        const contentScriptCssEntries = scripts.filter((scriptEntry) => {
          return (
            scriptEntry?.endsWith('.css') ||
            scriptEntry?.endsWith('.scss') ||
            scriptEntry?.endsWith('.sass') ||
            scriptEntry?.endsWith('.less')
          )
        })

        const importEntries = contentScriptCssEntries.map((cssEntry) => {
          const urlDir = path.dirname(absoluteUrl)
          const relativePath = path.relative(urlDir, cssEntry!)
          return `import("./${relativePath}");`
        })

        cssEntries.push(importEntries)
      }
    }
  }

  return cssEntries
}

export default function (this: InjectContentCssImportContext, source: string) {
  const options = this.getOptions()
  const manifestPath = options.manifestPath
  const manifest = require(manifestPath)
  const projectPath = path.dirname(manifestPath)

  validate(schema, options, {
    name: 'Inject (dynamic) import() to CSS',
    baseDataPath: 'options'
  })

  if (this._compilation?.options.mode === 'production') return source

  const url = urlToRequest(this.resourcePath)
  if (!manifest.content_scripts || !manifest.content_scripts.length)
    return source

  for (const [
    contentIndex,
    contentScript
  ] of manifest.content_scripts.entries()) {
    if (contentScript.js) {
      for (const [fileIndex, js] of contentScript.js.entries()) {
        // All content_script JS files of each content_script.matches
        // are bundled together, so we only need to add the
        // dynamic import() to the first file.
        if (fileIndex === 0) {
          const absoluteUrl = path.resolve(projectPath, js)

          if (url.includes(absoluteUrl)) {
            const cssEntriesToImport = getCssEntriesToImport(
              manifestPath,
              absoluteUrl
            )

            if (!cssEntriesToImport) return source

            const thisScriptImportEntries =
              cssEntriesToImport[contentIndex].join('\n')

            const fakeContentScriptCssFileText = `
/**
 * During development, we extract all content_script CSS files
 * and add them as dynamic imports to the content_script JS file,
 * so that we can reload them on the fly.
 * However, we need to add a fake CSS file to the manifest
 * so that the extension can be loaded without missing CSS files.
 *
 * This is what this file does ;)
 *
 * During production, we don't need to do this because we
 * actually add the CSS files to the content_script bundle.
*/
            `
            // This filename is a hack, but it works.
            const fakeContentScriptCssFile = getFilepath(
              `content_scripts-${contentIndex}`
            )

            this.emitFile(
              `${fakeContentScriptCssFile}.css`,
              fakeContentScriptCssFileText
            )

            return `${thisScriptImportEntries}${source}`
          }
        }
      }
    }
  }

  return source
}
