import path from 'path'
import {htmlFields} from './html-fields'
import {iconFields} from './icons-fields'
import {jsonFields} from './json-fields'
// import {localesFields} from './locales-fields'
import {scriptsFields} from './scripts-fields'
import {webResourcesFields} from './web-resources-fields'
import {type PluginInterface, type Manifest} from '../../../webpack-types'

// TODO: cezaraugusto type this
export interface ManifestFields {
  html: Record<string, any>
  icons: Record<string, any>
  json: Record<string, any>
  // locales: string,
  scripts: Record<string, any>
  web_accessible_resources: Record<string, any>
}

function removePrefixes(manifest: Manifest): Manifest {
  function recursivelyRemovePrefixes(obj: Manifest): Manifest {
    const result: Manifest = {}
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const newKey = key.includes(':') ? key.split(':')[1] : key
        if (typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
          result[newKey] = recursivelyRemovePrefixes(obj[key])
        } else {
          result[newKey] = obj[key]
        }
      }
    }
    return result
  }

  return recursivelyRemovePrefixes(manifest)
}

export function getManifestFieldsData({manifestPath}: PluginInterface) {
  const context = path.dirname(manifestPath)
  const manifest = require(manifestPath)
  const manifestNoPrefixes = removePrefixes(manifest)

  const fieldData = {
    html: htmlFields(context, manifestNoPrefixes),
    icons: iconFields(context, manifestNoPrefixes),
    json: jsonFields(context, manifestNoPrefixes),
    // locales: localesFields(context, manifestPath),
    scripts: scriptsFields(context, manifestNoPrefixes),
    web_accessible_resources: webResourcesFields(manifestNoPrefixes)
  }
  return fieldData
}
