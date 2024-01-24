import path from 'path'
import fs from 'fs'
import {validate} from 'schema-utils'
import {type LoaderContext} from 'webpack'
import {type Schema} from 'schema-utils/declarations/validate'
import parseChromeTabsCreate from './src/parsers/tabs/create'
import parseChromeActionSetPopup from './src/parsers/action/setPopup'
import parseChromeRuntimeGetURL from './src/parsers/runtime/getURL'

import resolvePath from './src/resolver'
import {
  errorMessage,
  isManifestAsset,
  isPagesPath,
  isPublicPath,
  isUrl
} from './src/utils'

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
  if (isUrl(result.path)) return source

  // const resultResolvedPath = resolvePath(self.rootContext, result.path)
  const resultAbsolutePath = path.resolve(self.rootContext, result.path)

  if (!fs.existsSync(resultAbsolutePath)) {
    self.emitError(errorMessage(resultAbsolutePath, result, self.resourcePath))
    return source
  }

  const isPublic = isPublicPath(self.rootContext, result.path)
  const isPages = isPagesPath(self.rootContext, result.path)

  if (
    !isManifestAsset(self.rootContext, resultAbsolutePath) &&
    !isPublic &&
    !isPages
  ) {
    self.emitFile(result.path, source)
  }

  return source
  // return source.replace(new RegExp(result.path, 'g'), resultResolvedPath)
}

export default function (this: BrowserExtensionContext, source: string) {
  const options = this.getOptions()

  validate(schema, options, {
    name: 'Browser Extension Loader',
    baseDataPath: 'options'
  })

  if (new RegExp(options.test).test(this.resourcePath)) {
    // const chromeActionSetPopup = parseChromeActionSetPopup(source)
    // const chromeTabCreateResults = parseChromeTabsCreate(source)
    // const chromeRuntimeGetURLResults = parseChromeRuntimeGetURL(source)

    let modifiedSource = source

    // // chrome.action.setPopup
    // chromeActionSetPopup.forEach((result) => {
    //   modifiedSource = processResult(this, result, modifiedSource)
    // })

    // // chrome.tabs.create
    // chromeTabCreateResults.forEach((result) => {
    //   modifiedSource = processResult(this, result, modifiedSource)
    // })

    // chrome.runtime.getURL
    // chromeRuntimeGetURLResults.forEach((result) => {
    //   modifiedSource = processResult(this, result, modifiedSource)
    // })

    return modifiedSource
  }

  return source
}
