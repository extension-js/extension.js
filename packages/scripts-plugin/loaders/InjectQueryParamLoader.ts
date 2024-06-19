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
    name: 'Add a is_content_css_import=true query param to css imports in content_scripts',
    baseDataPath: 'options'
  })

  const url = urlToRequest(this.resourcePath)

  if (manifest.content_scripts) {
    for (const contentScript of manifest.content_scripts) {
      if (!contentScript.js) continue

      for (const js of contentScript.js) {
        const absoluteUrl = path.resolve(projectPath, js as string)

        if (url.includes(absoluteUrl)) {
          // Find every CSS imports in the source and add a query param to them
          // so we can identify them later in the styleLoaders
          source = source.replace(
            /import\s+['"](.+\.css)['"]/g,
            "import '$1?is_content_css_import=true'"
          )

          return source
        }
      }
    }
  }

  return source
}
