import {validate} from 'schema-utils'
import {type Schema} from 'schema-utils/declarations/validate'
import {LoaderInterface} from '../../../webpack-types'

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
    }
  },
  additionalProperties: false
}

export default function ensureHMRForScripts(
  this: LoaderInterface,
  source: string
) {
  const options = this.getOptions()

  try {
    validate(schema, options, {
      name: 'html:ensure-hmr-for-scripts',
      baseDataPath: 'options'
    })
  } catch (error) {
    throw error
  }

  const reloadCode = `
if (import.meta.webpackHot) { import.meta.webpackHot.accept() }
`

  // Always inject minimal HMR accept to behave like minimal Vite for plain scripts

  // Minimal behavior: inject HMR accept wrapper for any handled script
  return `${reloadCode}${source}`
}
