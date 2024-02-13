import path from 'path'
import {type LoaderContext} from 'webpack'
import {validate} from 'schema-utils'
import {type Schema} from 'schema-utils/declarations/validate'
import * as parser from '@babel/parser'

import transformSource from './steps/transformSource'
import {IncludeList} from './types'
import emitResolverModule from './steps/emitResolverModule'
import getFileList from './steps/getFileList'

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
    exclude: {
      type: 'array'
    }
  }
}

interface ResolvePluginContext extends LoaderContext<any> {
  getOptions: () => {
    test: string
    manifestPath: string
    includeList: IncludeList
    exclude: string[]
  }
}

/**
 * browser-extension-loader is responsible for
 * resolving paths for specific browser extension api calls.
 * It works by adding a loader to the webpack configuration
 * that transforms the API calls to use the resolver module.
 *
 * The resolver module is responsible for resolving the
 * paths based on the manifest.json file and compilation
 * context.
 *
 * APIs supported:
 * - chrome.action.setIcon
 * - chrome.browserAction.setIcon
 * - chrome.pageAction.setIcon
 * - chrome.action.setPopup
 * - chrome.browserAction.setPopup
 * - chrome.pageAction.setPopup
 * - chrome.scriptBadge.setPopup
 * - chrome.devtools.panels.create
 * - chrome.declarativeContent.RequestContentScripts
 * - chrome.downloads.download
 * - chrome.runtime.getURL
 * - chrome.scripting.insertCSS
 * - chrome.scripting.removeCSS
 * - chrome.scripting.executeScript
 * - chrome.scripting.registerContentScripts
 * - chrome.scripting.unregisterContentScripts
 * - chrome.tabs.create
 * - chrome.tabs.executeScript
 * - chrome.tabs.insertCSS
 * - chrome.windows.create
 * - chrome.sidePanel.setOptions
 * - chrome.notifications.create
 */
export default function (this: ResolvePluginContext, source: string) {
  const options = this.getOptions()

  validate(schema, options, {
    name: 'Browser Extension Resolve Loader',
    baseDataPath: 'options'
  })

  if (new RegExp(options.test).test(this.resourcePath)) {
    const resolverName = 'resolver-module.js'

    // Skip if path is node_modules
    if (
      this.resourcePath.includes('node_modules') ||
      this.resourcePath.includes('dist/')
    ) {
      return source
    }

    const ast = parser.parse(source, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript']
    })

    // 1 - Emit the resolver module. This will be used by the
    // browser extension to resolve the API methods.
    const resolverAbsolutePath = path.join(__dirname, resolverName)
    emitResolverModule(this, resolverAbsolutePath)

    // 2 - Define the path of the resolver module, relative to the current file.
    // This is the import path that will be used by the API methods.
    const resolverRelativePath = path.relative(
      path.dirname(this.resourcePath),
      resolverAbsolutePath
    )

    // 3 - Get the current source, add the resolver module import and
    // transform the API methods to use the resolver module.
    return transformSource(ast, source, resolverRelativePath)
  }

  return source
}
