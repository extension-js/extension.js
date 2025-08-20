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

  try {
    validate(schema, options, {
      name: 'html:ensure-hmr-for-scripts',
      baseDataPath: 'options'
    })
  } catch (error) {
    throw error
  }

  const resourcePath = this.resourcePath || ''
  const url = urlToRequest(resourcePath)
  const reloadCode = `
if (import.meta.webpackHot) { import.meta.webpackHot.accept() }
`

  // Always inject minimal HMR accept to behave like minimal Vite for plain scripts

  // Minimal behavior: inject HMR accept wrapper for any handled script
  return `${reloadCode}${source}`
}
