import path from 'path'
import {htmlFields} from './html-fields'
import {iconFields} from './icons-fields'
import {jsonFields} from './json-fields'
import {localesFields} from './locales-fields'
import {scriptsFields} from './scripts-fields'
import {webResourcesFields} from './web-resources-fields'
import {type PluginInterface} from '../../../webpack-types'
import * as utils from '../../../lib/utils'

// TODO: cezaraugusto type this
export interface ManifestFields {
  html: Record<string, any>
  icons: Record<string, any>
  json: Record<string, any>
  // locales: string,
  scripts: Record<string, any>
  web_accessible_resources: Record<string, any>
}

export function getManifestFieldsData({
  manifestPath,
  browser
}: PluginInterface) {
  const context = path.dirname(manifestPath)
  const manifest = require(manifestPath)
  const manifestNoPrefixes = utils.removeManifestKeysNotFromCurrentBrowser(
    manifest,
    browser || 'chrome'
  )

  const fieldData = {
    html: htmlFields(context, manifestNoPrefixes),
    icons: iconFields(context, manifestNoPrefixes),
    json: jsonFields(context, manifestNoPrefixes),
    locales: localesFields(context, manifestPath),
    scripts: scriptsFields(context, manifestNoPrefixes),
    web_accessible_resources: webResourcesFields(manifestNoPrefixes)
  }
  return fieldData
}
