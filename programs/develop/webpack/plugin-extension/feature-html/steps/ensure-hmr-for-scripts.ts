import * as path from 'path'
import * as fs from 'fs'
import {urlToRequest} from 'loader-utils'
import {validate} from 'schema-utils'
import {type Schema} from 'schema-utils/declarations/validate'
import {LoaderInterface} from '../../../webpack-types'
import {getAssetsFromHtml} from '../html-lib/utils'
import {isUsingJSFramework} from '../../../lib/utils'

const schema: Schema = {
  type: 'object',
  required: ['manifestPath', 'includeList'],
  properties: {
    manifestPath: {
      type: 'string'
    },
    includeList: {
      type: 'object'
    },
    excludeList: {
      type: 'object'
    }
  }
}

export default function ensureHMRForScripts(
  this: LoaderInterface,
  source: string
) {
  const options = this.getOptions()
  const manifestPath = options.manifestPath
  const projectPath = path.dirname(manifestPath)

  try {
    validate(schema, options, {
      name: 'html:ensure-hmr-for-scripts',
      baseDataPath: 'options'
    })
  } catch (error) {
    throw error
  }

  const url = urlToRequest(this.resourcePath)
  const reloadCode = `
// TODO: cezaraugusto re-visit this
if (import.meta.webpackHot) { import.meta.webpackHot.accept() };
  `

  if (isUsingJSFramework(projectPath)) return source

  const allEntries = options.includeList || {}

  for (const field of Object.entries(allEntries)) {
    const [, resource] = field

    // Resources from the manifest lib can come as undefined.
    if (!resource) continue

    if (!fs.existsSync(resource as string)) {
      return source
    }

    const htmlAssets = getAssetsFromHtml(resource as string)
    const fileAssets = htmlAssets?.js || []

    for (const asset of fileAssets) {
      // Remove hash fragments and query parameters for comparison
      const cleanAsset = asset.split('#')[0].split('?')[0]
      const cleanUrl = url.split('#')[0].split('?')[0]

      // Normalize paths
      const normalizedAsset = path.normalize(cleanAsset)
      const normalizedUrl = path.normalize(cleanUrl)

      // Only match if the paths are exactly the same
      if (normalizedAsset === normalizedUrl) {
        return `${reloadCode}${source}`
      }
    }
  }

  return source
}
