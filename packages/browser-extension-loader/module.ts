import path from 'path'
import {validate} from 'schema-utils'
import {type LoaderContext} from 'webpack'
import {type Schema} from 'schema-utils/declarations/validate'
import * as parser from '@babel/parser'
import traverse from '@babel/traverse'

import resolvePath from './src/resolver'
import {
  errorMessage,
  isManifestAsset,
  isPagesPath,
  isPublicPath,
  isUrl
} from './src/utils'
import {has} from './src/checkApiExists'
import {
  handeFilesProperty,
  handlePathProperty,
  handlePopupProperty,
  handleStringProperty,
  handleUrlProperty
} from './src/parser'

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

  const resultResolvedPath = resolvePath(self.rootContext, result.path)
  const resultAbsolutePath = path.resolve(self.rootContext, result.path)

  // if (!fs.existsSync(resultAbsolutePath)) {
  //   self.emitError(errorMessage(resultAbsolutePath, result, self.resourcePath))
  //   return source
  // }

  const isPublic = isPublicPath(self.rootContext, result.path)
  const isPages = isPagesPath(self.rootContext, result.path)

  if (
    !isManifestAsset(self.rootContext, resultAbsolutePath) &&
    !isPublic &&
    !isPages
  ) {
    self.emitFile(result.path, source)
  }

  return source.replace(
    new RegExp(result.path, 'g'),
    // result.path
    result.path + ` /* browser-extension-loader ${resultResolvedPath} */ `
  )
}

interface ParseResult {
  path: string
}

export default function (this: BrowserExtensionContext, source: string) {
  const options = this.getOptions()

  validate(schema, options, {
    name: 'Browser Extension Loader',
    baseDataPath: 'options'
  })

  if (new RegExp(options.test).test(this.resourcePath)) {
    const ast = parser.parse(source, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript']
    })

    const results: ParseResult[] = []

    traverse(ast as any, {
      CallExpression(path: any) {
        const callee = path.node.callee
        const args = path.node.arguments

        // // Handle cases for different Chrome APIs
        // if (
        //   has(callee, 'chrome.action.setIcon') ||
        //   has(callee, 'chrome.browserAction.setIcon') ||
        //   has(callee, 'chrome.pageAction.setIcon')
        // ) {
        //   args[0] = handlePathProperty(args[0])
        // }

        // if (
        //   has(callee, 'chrome.action.setPopup') ||
        //   has(callee, 'chrome.browserAction.setPopup') ||
        //   has(callee, 'chrome.pageAction.setPopup') ||
        //   has(callee, 'chrome.scriptBadge.setPopup')
        // ) {
        //   args[0] = handlePopupProperty(args[0])
        // }

        // if (has(callee, 'chrome.devtools.panels.create')) {
        //   args[1] = handleStringProperty(args[1])
        //   args[2] = handleStringProperty(args[2])
        // }

        // if (has(callee, 'chrome.downloads.download')) {
        //   args[0] = handleUrlProperty(args[0])
        // }

        // if (has(callee, 'chrome.runtime.getURL')) {
        //   args[0] = handleStringProperty(args[0])
        // }

        // if (
        //   has(callee, 'chrome.scripting.insertCSS') ||
        //   has(callee, 'chrome.scripting.removeCSS') ||
        //   has(callee, 'chrome.scripting.executeScript') ||
        //   has(callee, 'chrome.scripting.registerContentScript') ||
        //   has(callee, 'chrome.scripting.unregisterContentScript')
        // ) {
        //   args[0] = handeFilesProperty(args[0])
        // }

        // if (
        //   has(callee, 'chrome.tabs.create') ||
        //   has(callee, 'chrome.tabs.executeScript') ||
        //   has(callee, 'chrome.tabs.insertCSS')
        // ) {
        //   if (args.length > 0) {
        //     args[0] = handleUrlProperty(args[0])
        //   }
        // }

        // if (has(callee, 'chrome.sidePanel.setOptions')) {
        //   args[0] = handlePathProperty(args[0])
        // }

        // results.forEach((result) => {
        //   source = processResult(this as any, result, source)
        // })
      }
    })
  }

  return source
}
