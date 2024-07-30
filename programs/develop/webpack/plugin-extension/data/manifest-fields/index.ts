import path from 'path'
import {htmlFields} from './html-fields'
import {iconFields} from './icons-fields'
import {jsonFields} from './json-fields'
// import {localesFields} from './locales-fields'
import {scriptsFields} from './scripts-fields'
import {webResourcesFields} from './web-resources-fields'
import {type PluginInterface} from '../../../webpack-types'

// TODO: cezaraugusto type this
export interface ManifestFields {
  html: Record<string, any>
  icons: Record<string, any>
  json: Record<string, any>
  // locales: string,
  scripts: Record<string, any>
  web_accessible_resources: Record<string, any>
}

export function getManifestFieldsData({manifestPath}: PluginInterface) {
  const context = path.dirname(manifestPath)
  const manifest = require(manifestPath)
  const fieldData = {
    html: htmlFields(context, manifest),
    icons: iconFields(context, manifest),
    json: jsonFields(context, manifest),
    // locales: localesFields(context, manifestPath),
    scripts: scriptsFields(context, manifest),
    web_accessible_resources: webResourcesFields(context, manifest)
  }
  return fieldData
}
