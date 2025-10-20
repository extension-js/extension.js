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
  const projectPath = path.dirname(manifestPath)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))

  validate(schema, options, {
    name: 'scripts:content-script-wrapper',
    baseDataPath: 'options'
  })

  // Inject a simple console marker only for declared content scripts
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

  const resourceAbsPath = path.normalize(this.resourcePath)
  const isDeclaredContentScript = declaredContentJsAbsPaths.some(
    (abs) => resourceAbsPath === path.normalize(abs)
  )

  if (isDeclaredContentScript) {
    const marker = `\nconsole.log('[Extension.js] content-script-wrapper active');\n`
    return `${marker}${source}`
  }

  return source
}
