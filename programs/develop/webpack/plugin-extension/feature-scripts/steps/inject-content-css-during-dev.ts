import path from 'path'
import {urlToRequest} from 'loader-utils'
import {validate} from 'schema-utils'
import {type LoaderContext} from '../../../webpack-types'
import {type Schema} from 'schema-utils/declarations/validate'
import {getRelativePath} from '../../../lib/utils'
import {getScriptEntries, getCssEntries} from '../scripts-lib/utils'

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

const beautifulFileContent = `/** 
 * Welcome to to your content_scripts CSS file during development!
 * To speed up the development process, your styles
 * are being injected directly into the head of the webpage,
 * and will be removed when you build your application, along
 * with this file. If you are seeing this file in a production build,
 * it means that something is wrong with your build configuration.
 */`

export default function injectContentCssDuringDev(
  this: LoaderContext,
  source: string
) {
  const options = this.getOptions()

  validate(schema, options, {
    name: 'scripts:inject-content-css-during-dev',
    baseDataPath: 'options'
  })

  const scriptFields = options.includeList || {}
  const cssImportPaths: Array<{
    feature: string
    scriptPath: string
    cssImports: string[]
  }> = []
  const scriptEntries = Object.entries(scriptFields).filter(
    ([feature, scriptPath]) => feature.startsWith('content') && scriptPath
  )

  if (!scriptEntries.length) return source

  // The goal of this plugin is to enable HMR to standalone content_script.css
  // files. To do that, we get all CSS files defined and inject them
  // as dynamic imports in the content_script.js file.
  for (const contentScript of scriptEntries) {
    const [feature, scriptPath] = contentScript

    const scriptImports = [
      ...getScriptEntries(scriptPath, options.excludeList || {})
    ]
    // content_scripts-1: ['content_script-a.css', 'content_script-b.css']
    // content_scripts-2: ['content_script-c.css', 'content_script-d.css']
    const cssImports = getCssEntries(scriptPath, options.excludeList || {})

    // 1 - Since having a .js file is mandatory for HMR to work, if
    // during development if user has a content_script.css but not
    // a content_script.js file, we create one for each content_script.css
    // defined in the manifest.
    if (cssImports.length && !scriptImports.length) {
      const minimumContentFile = path.resolve(
        __dirname,
        'minimum-content-file.mjs'
      )

      scriptImports.push(minimumContentFile)
    }

    cssImportPaths.push({
      feature,
      scriptPath: scriptImports[0],
      cssImports: cssImports.map((cssImport) => {
        return getRelativePath(scriptImports[0], cssImport)
      })
    })
  }

  const url = urlToRequest(this.resourcePath)

  // 1 - Since we are extracting CSS files from content.css in
  // the manifest.json file, we need to have a placeholder
  // file to prevent the manifest from looking to a missing file.
  cssImportPaths.forEach(({feature, scriptPath, cssImports}) => {
    if (url.includes(scriptPath)) {
      // Dynamically generate import statements for CSS files
      const dynamicImports = cssImports
        .map((cssImport) => {
          const [, contentName] = feature.split('/')
          const index = contentName.split('-')[1]
          const filename = path.basename(cssImport)
          const chunkName = `web_accessible_resources/resource-${index}/${filename.replace(
            '.',
            '_'
          )}`
          // Ensure to resolve the path relative to the manifest or webpack context
          // const resolvedPath = getRelativePath(options.manifestPath, cssImport)
          // Generate a dynamic import statement for each CSS file
          return (
            `import(/* webpackChunkName: "${chunkName}" */ '${cssImport}')` +
            `.then(css => console.info('content_script.css loaded', css))` +
            `.catch(err => console.error(err));`
          )
        })
        .join('\n')

      this.emitFile(`${feature}.css`, beautifulFileContent)

      // Prepend the dynamic imports to the module source
      source = `${dynamicImports}\n${source}`
    }
  })

  return source
}
