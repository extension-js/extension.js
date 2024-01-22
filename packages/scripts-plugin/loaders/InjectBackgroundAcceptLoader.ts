import path from 'path'
import {urlToRequest} from 'loader-utils'
import {validate} from 'schema-utils'
import {type LoaderContext} from 'webpack'
import {type Schema} from 'schema-utils/declarations/validate'

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

interface InjectBackgroundAcceptContext extends LoaderContext<any> {
  getOptions: () => {
    manifestPath: string
  }
}

export default function (this: InjectBackgroundAcceptContext, source: string) {
  const options = this.getOptions()
  const manifestPath = options.manifestPath
  const projectPath = path.dirname(manifestPath)
  const manifest = require(manifestPath)

  validate(schema, options, {
    name: 'Inject HMR (background.scripts) Accept',
    baseDataPath: 'options'
  })

  if (this._compilation?.options.mode === 'production') return source

  const url = urlToRequest(this.resourcePath)
  const reloadCode = `
if (import.meta.webpackHot) { import.meta.webpackHot.accept() };
  `

  if (manifest.background) {
    if (manifest.background.scripts) {
      for (const bgScript of manifest.background.scripts) {
        const absoluteUrl = path.resolve(projectPath, bgScript)
        if (url.includes(absoluteUrl)) {
          return `${reloadCode}${source}`
        }
      }
    }
  }

  return source
}
