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
    cssImportPaths: Array<{
      feature: string
      scriptPath: string
      cssImports: string[]
    }>
  }
}

const beautifulFileContent = `/** 
 * Welcome to tyour content_scripts CSS file during development!
 * To speed up the development process, your styles
 * are being injected directly into the head of the webpage,
 * and will be removed when you build your application, along
 * with this file. If you are seeing this file in a production build,
 * it means that something is wrong with your build configuration.
 */`

export default function (this: InjectDynamicCssLoaderContext, source: string) {
  const options = this.getOptions()
  const cssImportPaths = options.cssImportPaths

  validate(schema, options, {
    name: 'Inject CSS as dynamic imports for content scripts',
    baseDataPath: 'options'
  })

  const url = urlToRequest(this.resourcePath)

  // 1 - Since we are extracting CSS files from content.css in
  // the manifest.json file, we need to have a placeholder
  // file to prevent the manifest from looking to a missing file.
  cssImportPaths.forEach(({feature, scriptPath, cssImports}) => {
    if (url.includes(scriptPath)) {
      // Dynamically generate import statements for CSS files
      const dynamicImports = cssImports
        .map((cssImport) => {
          // Ensure to resolve the path relative to the manifest or webpack context
          // const resolvedPath = getRelativePath(options.manifestPath, cssImport)
          // Generate a dynamic import statement for each CSS file
          return `import(/* webpackChunkName: "${
            feature + '_'
          }" */ '${cssImport}').then(css => console.log('content_script.css loaded:', css)).catch(err => console.error(err));`
        })
        .join('\n')

      this.emitFile(`${feature}.css`, beautifulFileContent)

      // Prepend the dynamic imports to the module source
      source = `${dynamicImports}\n${source}`
    }
  })

  return source
}
