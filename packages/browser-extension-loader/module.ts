import path from 'path'
import fs from 'fs'
import {validate} from 'schema-utils'
import {type LoaderContext} from 'webpack'
import {type Schema} from 'schema-utils/declarations/validate'
import parseChromeTabsCreate from './src/parsers/parseChromeTabsCreate'
import resolvePath from './src/resolver'
import {errorMessage, isPagesPath, isPublicPath, isUrl} from './src/utils'

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

function processResult(
  self: BrowserExtensionContext,
  result: {path: string},
  source: string
) {
  const resultResolvedPath = resolvePath(self.context, result.path)
  const resultAbsolutePath = path.resolve(self.context, result.path)

  if (!isUrl(result.path) && !fs.existsSync(resultAbsolutePath)) {
    self.emitError(errorMessage(resultAbsolutePath, result, self.resourcePath))
    return source
  }

  const isPublic = isPublicPath(self.context, result.path)
  const isPages = isPagesPath(self.context, result.path)

  if (!isUrl(resultResolvedPath) && !isPublic && !isPages) {
    self.emitFile(result.path, source)
  }

  if (!isUrl(resultResolvedPath)) {
    return source.replace(new RegExp(result.path, 'g'), resultResolvedPath)
  }

  return source
}

export default function (this: BrowserExtensionContext, source: string) {
  const options = this.getOptions()

  validate(schema, options, {
    name: 'Browser Extension Loader',
    baseDataPath: 'options'
  })

  if (new RegExp(options.test).test(this.resourcePath)) {
    const chromeTabCreateResults = parseChromeTabsCreate(source)
    let modifiedSource = source

    chromeTabCreateResults.forEach((result) => {
      modifiedSource = processResult(this, result, modifiedSource)
    })

    return modifiedSource
  }

  return source
}
