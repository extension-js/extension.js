import path from 'path'
import webpack from 'webpack'
import {IncludeList, ResolvePluginInterface} from './types'
import getManifestEntries from './loader/getManifestEntries'

/**
 * ResolvePlugin is responsible for resolving paths for
 * specific browser extension api calls. It works by
 * adding a loader to the webpack configuration that
 * transforms the API calls to use the resolver module.
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
 * - chrome.downloads.download
 * - chrome.runtime.getURL
 * - chrome.scripting.insertCSS
 * - chrome.scripting.removeCSS
 * - chrome.scripting.executeScript
 * - chrome.scripting.registerContentScript
 * - chrome.scripting.unregisterContentScript
 * - chrome.tabs.create
 * - chrome.tabs.executeScript
 * - chrome.tabs.insertCSS
 * - chrome.windows.create
 * - chrome.sidePanel.setOptions
 * - chrome.notifications.create
 */
export default class ResolvePlugin {
  public readonly manifestPath: string
  public readonly includeList?: IncludeList

  constructor(options: ResolvePluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList || {}
  }

  public apply(compiler: webpack.Compiler): void {
    // 1 - Add the resolver loader.
    // This loader will be used to transform the API methods
    // to use the resolver module.
    compiler.options.module?.rules.push({
      test: /\.(t|j)sx?$/,
      loader: require.resolve(path.resolve(__dirname, './loader/index.js')),
      options: {
        manifestPath: this.manifestPath,
        includeList: this.includeList
      }
    })
  }
}
