// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import webpack from 'webpack'
import type {DevOptions} from '../../extensionDev'

// Plugins
import ManifestPlugin from 'webpack-browser-extension-manifest-plugin'
import HtmlPlugin from 'webpack-browser-extension-html-plugin'
import ScriptsPlugin from 'webpack-browser-extension-scripts-plugin'
import LocalesPlugin from 'webpack-browser-extension-locales-plugin'
import JsonPlugin from 'webpack-browser-extension-json-plugin'
import IconsPlugin from 'webpack-browser-extension-icons-plugin'
import ResourcesPlugin from 'webpack-browser-extension-resources-plugin'

// Config
import {getDynamicPagesPath, getStaticFolderPath} from '../config/getPath'

export default function extensionPlugins(
  projectPath: string,
  {noPolyfill, browser}: DevOptions
) {
  const manifestPath = path.resolve(projectPath, 'manifest.json')

  return {
    name: 'extensionPlugins',
    apply: (compiler: webpack.Compiler) => {
      // Generate a manifest file with all the assets we need
      new ManifestPlugin({
        browser,
        manifestPath,
        exclude: [
          // Exclude paths that are in the /public/ folder
          getStaticFolderPath(projectPath),
          // Exclude filenames used by the reloader plugin.
          // Otherwise we will parse it to background.[scriptname],
          // which we want to avoid.
          path.join(projectPath, 'extension-html-reloader'),
          path.join(projectPath, 'extension-bg-reloader')
        ]
      }).apply(compiler)

      // Get every field in manifest that allows an .html file
      new HtmlPlugin({
        manifestPath,
        exclude: [getStaticFolderPath(projectPath)],
        pages: getDynamicPagesPath(projectPath)
      }).apply(compiler)

      // Get all scripts (bg, content, sw) declared in manifest
      new ScriptsPlugin({
        manifestPath,
        // Exclude paths that are in the /public/ folder
        exclude: [getStaticFolderPath(projectPath)]
      }).apply(compiler)

      // Get locales
      new LocalesPlugin({manifestPath}).apply(compiler)

      // Grab all JSON assets from manifest except _locales
      new JsonPlugin({
        manifestPath,
        // Exclude paths that are in the /public/ folder
        exclude: [getStaticFolderPath(projectPath)]
      }).apply(compiler)

      // Grab all icon assets from manifest including popup icons
      new IconsPlugin({
        manifestPath,
        // Exclude paths that are in the /public/ folder
        exclude: [getStaticFolderPath(projectPath)]
      }).apply(compiler)

      // Grab all resources from script files
      // (background, content_scripts, service_worker)
      // and add them to the assets bundle.
      new ResourcesPlugin({
        manifestPath
        // Exclude paths that are in the /public/ folder
        // exclude: [getStaticFolderPath(projectPath)]
      }).apply(compiler)

      // Allow browser polyfill as needed
      if (!noPolyfill) {
        if (browser !== 'firefox') {
          new webpack.ProvidePlugin({
            browser: require.resolve('webextension-polyfill')
          }).apply(compiler)
        }
      }
    }
  }
}
