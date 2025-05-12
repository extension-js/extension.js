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
  properties: {
    test: {
      type: 'string'
    },
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

  validate(schema, options, {
    name: 'html:ensure-hmr-for-scripts',
    baseDataPath: 'options'
  })

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
    if (resource) {
      if (!fs.existsSync(resource as string)) return

      const htmlAssets = getAssetsFromHtml(resource as string)
      const fileAssets = htmlAssets?.js || []

      for (const asset of fileAssets) {
        const absoluteUrl = path.resolve(projectPath, asset)

        if (url.includes(absoluteUrl)) {
          return `${reloadCode}${source}`
        }
      }
    }
  }

  return source
}
