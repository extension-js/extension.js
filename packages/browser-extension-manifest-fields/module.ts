import htmlFromManifest from './fields/html-fields'
import iconFromManifest from './fields/icons-fields'
import jsonFromManifest from './fields/json-fields'
import localesFromManifest from './fields/locales-fields'
import scriptsFromManifest from './fields/scripts-fields'
import webResourcesFromManifest from './fields/web-resources-fields'
import {type ManifestFields, type ManifestData} from './types'

export {type ManifestFields}

function browserExtensionManifestFields(
  manifestPath: string,
  manifest?: ManifestData
) {
  // In case user don't provide a manifest content,
  // we will try to load it from the manifestPath.
  const manifestContent = manifest || require(manifestPath)

  return {
    html: htmlFromManifest(manifestPath, manifestContent),
    icons: iconFromManifest(manifestPath, manifestContent),
    json: jsonFromManifest(manifestPath, manifestContent),
    locales: localesFromManifest(manifestPath, manifestContent),
    scripts: scriptsFromManifest(manifestPath, manifestContent),
    webResources: webResourcesFromManifest(manifestPath, manifestContent)
  }
}

export default browserExtensionManifestFields
