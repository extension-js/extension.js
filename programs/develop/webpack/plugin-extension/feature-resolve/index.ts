import path from 'path';
import webpack from 'webpack';
import { type FilepathList, type PluginInterface } from '../../types';

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
interface LoaderOptions {
  jsx?: boolean;
  typescript?: boolean;
}

export class ResolvePlugin {
  public readonly manifestPath: string;
  public readonly includeList?: FilepathList;
  public readonly excludeList?: FilepathList;
  public readonly loaderOptions?: LoaderOptions;

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath;
    this.includeList = options.includeList;
    this.excludeList = options.excludeList;
    this.loaderOptions = (options as any).loaderOptions;
  }

  public apply(compiler: webpack.Compiler): void {
    new webpack.ProvidePlugin({
      r: [path.resolve(__dirname, './resolver-module.mjs'), 'default'],
    }).apply(compiler);

    // 1 - Add the resolver loader.
    // This loader will be used to transform the API methods
    // to use the resolver module.
    compiler.options.module?.rules.push({
      test: /\.(t|j)sx?$/,
      loader: require.resolve(path.resolve(__dirname, './resolver-loader.js')),
      options: {
        manifestPath: this.manifestPath,
        includeList: this.includeList,
        jsx: this.loaderOptions ? this.loaderOptions['jsx'] : false,
        typescript: this.loaderOptions
          ? this.loaderOptions['typescript']
          : false,
      },
    });
  }
}
