import {validate} from 'schema-utils'
import {type LoaderContext} from 'webpack'
import {type Schema} from 'schema-utils/declarations/validate'
import parseChromeTabsCreate from './src/parsers/parseChromeTabsCreate'
import resolvePath from './src/resolver'

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

interface BrowserExtensionContext extends LoaderContext<any> {
  getOptions: () => {
    test: string
    options: {
      manifestPath: string
      include: string
      exclude: string
    }
  }
}

export default function (this: BrowserExtensionContext, source: string) {
  const options = this.getOptions()

  validate(schema, options, {
    name: 'Browser Extension Loader',
    baseDataPath: 'options'
  })

  if (new RegExp(options.test).test(this.resourcePath)) {
    const chromeTabCreateResults = parseChromeTabsCreate(source)

    chromeTabCreateResults.forEach((result) => {
      const resolvedPath = resolvePath(this.context, result.path)
      const isPublic = resolvedPath.startsWith('/public')
      const isPages = resolvedPath.startsWith('/pages')

      // If that's a resource we don't know about but it exists,
      // return the absolute path and emit the file.
      if (!isPublic || !isPages) {
        this.emitFile(result.path, source)
      }

      source = source.replace(result.path, resolvedPath)
    })
  }

  return source
}
