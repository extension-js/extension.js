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
import ResolvePlugin from 'webpack-browser-extension-resolve-plugin'
import ManifestPlugin from 'webpack-browser-extension-manifest-plugin'
import HtmlPlugin from 'webpack-browser-extension-html-plugin'
import ScriptsPlugin from 'webpack-browser-extension-scripts-plugin'
import LocalesPlugin from 'webpack-browser-extension-locales-plugin'
import JsonPlugin from 'webpack-browser-extension-json-plugin'
import IconsPlugin from 'webpack-browser-extension-icons-plugin'
import ResourcesPlugin from 'webpack-browser-extension-resources-plugin'

// Handle special folders feature
import {
  generatePagesEntries,
  generateScriptsEntries,
  generateStaticEntries,
  scanHtmlFilesInFolder,
  scanScriptFilesInFolder
} from '../config/specialFolders'

// FUTURE: extension.config.js
import {
  getPagesFolderPath,
  getScriptsFolderPath,
  getStaticFolderPath
} from '../config/userOptions'

export default function extensionPlugins(
  projectPath: string,
  {polyfill, browser}: DevOptions
) {
  const manifestPath = path.resolve(projectPath, 'manifest.json')

  // All extension-create special folders
  const pagesFolder = getPagesFolderPath(projectPath)
  const scriptsFolder = getScriptsFolderPath(projectPath)
  const staticFolder = getStaticFolderPath(projectPath)

  // All files in each special folder
  const allPages = scanHtmlFilesInFolder(pagesFolder)
  const allScripts = scanScriptFilesInFolder(projectPath, scriptsFolder)
  const allStatic = scanScriptFilesInFolder(projectPath, staticFolder)

  // resolve-plugin expects a key-value pair of all files
  const pagesList = generatePagesEntries(allPages)
  const scriptsList = generateScriptsEntries(allScripts)
  const staticList = generateStaticEntries(projectPath, allStatic)

  return {
    name: 'extensionPlugins',
    apply: (compiler: webpack.Compiler) => {
      console.log('signal 0 --------')
      new ResolvePlugin({
        manifestPath,
        // In addition to manifest fields, ensure we can
        // resolve files from /script and /pages
        includeList: {
          ...pagesList,
          ...scriptsList,
          ...staticList
        }
      }).apply(compiler)

      // Generate a manifest file with all the assets we need
      new ManifestPlugin({
        browser,
        manifestPath,
        exclude: [staticFolder]
      }).apply(compiler)

      // Get every field in manifest that allows an .html file
      new HtmlPlugin({
        manifestPath,
        include: allPages,
        exclude: [staticFolder]
      }).apply(compiler)

      // Get all scripts (bg, content, sw) declared in manifest
      new ScriptsPlugin({
        manifestPath,
        include: allScripts,
        exclude: [staticFolder]
      }).apply(compiler)

      // Get locales
      new LocalesPlugin({manifestPath}).apply(compiler)

      // Grab all JSON assets from manifest except _locales
      new JsonPlugin({
        manifestPath,
        exclude: [staticFolder]
      }).apply(compiler)

      // Grab all icon assets from manifest including popup icons
      new IconsPlugin({
        manifestPath,
        exclude: [staticFolder]
      }).apply(compiler)

      // Grab all resources from script files
      // (background, content_scripts, service_worker)
      // and add them to the assets bundle.
      new ResourcesPlugin({
        manifestPath
        // exclude: [staticFolder]
      }).apply(compiler)

      // Allow browser polyfill as needed
      // TODO: move this to webpack-browser-extension-polyfill plugin.
      if (polyfill) {
        if (browser !== 'firefox') {
          new webpack.ProvidePlugin({
            browser: require.resolve('webextension-polyfill')
          }).apply(compiler)
        }
      }
    }
  }
}
