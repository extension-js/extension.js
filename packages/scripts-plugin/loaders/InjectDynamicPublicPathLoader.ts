import path from 'path'
import {urlToRequest} from 'loader-utils'
import {validate} from 'schema-utils'
import {type LoaderContext} from 'webpack'
import {type Schema} from 'schema-utils/declarations/validate'
import {isUsingReact} from '../helpers/utils'

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

interface InjectDynamicPublicPathLoaderContext extends LoaderContext<any> {
  getOptions: () => {
    manifestPath: string
  }
}

export default function (
  this: InjectDynamicPublicPathLoaderContext,
  source: string
) {
  const options = this.getOptions()
  const manifestPath = options.manifestPath
  const projectPath = path.dirname(manifestPath)
  const manifest = require(manifestPath)

  validate(schema, options, {
    name: 'Inject the dynamic webpack publicPath code',
    baseDataPath: 'options'
  })

  if (this._compilation?.options.mode === 'production') return source

  const url = urlToRequest(this.resourcePath)
  const reloadCode = `
;__webpack_public_path__ = chrome.extension.getURL('/');
  `

  if (manifest.background) {
    if (manifest.background.scripts) {
      for (const bgScript of manifest.background.scripts) {
        const absoluteUrl = path.resolve(projectPath, bgScript as string)
        if (url.includes(absoluteUrl)) {
          return `${reloadCode}${source}`
        }
      }
    }

    if (manifest.background.service_worker) {
      const absoluteUrl = path.resolve(
        projectPath,
        manifest.background.service_worker
      )
      if (url.includes(absoluteUrl)) {
        return `${reloadCode}${source}`
      }
    }
  }

  return source
}
