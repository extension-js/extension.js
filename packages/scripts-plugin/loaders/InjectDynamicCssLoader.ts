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
    },
    cssImportPaths: {
      type: 'array'
    }
  }
}

interface InjectDynamicCssLoaderContext extends LoaderContext<any> {
  getOptions: () => {
    manifestPath: string
    cssImportPaths: {
      feature: string
      scriptPath: string
      cssImports: string[]
    }[]
  }
}

export default function (this: InjectDynamicCssLoaderContext, source: string) {
  const options = this.getOptions()
  const cssImportPaths = options.cssImportPaths

  validate(schema, options, {
    name: 'Inject CSS as dynamic imports for content scripts',
    baseDataPath: 'options'
  })

  const url = urlToRequest(this.resourcePath)

  for (const {feature, scriptPath, cssImports} of cssImportPaths) {
    if (url.includes(scriptPath)) {
      // 1 - Since we are extracting CSS files from content.css in
      // the manifest.json file, we need to have a placeholder
      // file to prevent the manifest fro mlooking to a amissing file.
      this.emitFile(`${feature}.css`, '/** hello */')

      // 2 - Inject dynamic imports for CSS files
      const cssImportsParsed = cssImports.map((cssImport) => {
        return `import('${cssImport}');`
      })

      return `;${cssImportsParsed.join('\n')}${source}`
    }
  }

  return source
}
