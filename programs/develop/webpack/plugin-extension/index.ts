// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import {Compiler} from 'webpack'
import {getManifestFieldsData} from './data/manifest-fields'
import {getSpecialFoldersData} from './data/special-folders'

// Plugins
import ResolvePlugin from 'webpack-browser-extension-resolve'
import {ManifestPlugin} from './feature-manifest'
import HtmlPlugin from 'webpack-browser-extension-html'
import {ScriptsPlugin} from './feature-scripts'
import LocalesPlugin from 'webpack-browser-extension-locales'
import JsonPlugin from 'webpack-browser-extension-json'
import IconsPlugin from 'webpack-browser-extension-icons'
import ResourcesPlugin from 'webpack-browser-extension-resources'
import {SpecialFoldersPlugin} from './feature-special-folders'
import {PluginInterface} from '../types'

// Handle special folders feature
import {
  generatePublicEntries,
  generatePagesEntries,
  generateScriptsEntries,
  scanPublicFilesInFolder,
  scanHtmlFilesInFolder,
  scanScriptFilesInFolder
} from '../config/specialFolders'

// FUTURE: extension.config.js
import {
  getPagesFolderPath,
  getScriptsFolderPath,
  getPublicFolderPath
} from '../config/userOptions'

export class ExtensionPlugin {
  public readonly manifestPath: string
  public readonly browser: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler): void {
    const projectPath = compiler.options.context || ''
    const manifestPath = this.manifestPath
    const browser = this.browser

    // All Extension special folders
    // public/ - static assets. Copy/paste all files to the output folder
    const publicFolder = getPublicFolderPath(projectPath)
    // pages/ - Add every .html file inside pages/ to the compilation
    const pagesFolder = getPagesFolderPath(projectPath)
    // pages/ - Add every .js-like (see webpack module extensions)
    // file inside sxripts/ to the compilation
    const scriptsFolder = getScriptsFolderPath(projectPath)

    // All files in each special folder
    const allPublic = scanPublicFilesInFolder(publicFolder)
    const allPages = scanHtmlFilesInFolder(pagesFolder)
    const allScripts = scanScriptFilesInFolder(projectPath, scriptsFolder)

    // resolve-plugin expects a key-value pair of all files
    const publicList = generatePublicEntries(projectPath, allPublic)
    const pagesList = generatePagesEntries(allPages)
    const scriptsList = generateScriptsEntries(allScripts)

    const manifestFieldsData = getManifestFieldsData({manifestPath})
    const specialFoldersData = getSpecialFoldersData({manifestPath})

    new ResolvePlugin({
      manifestPath,
      // In addition to manifest fields, ensure we can
      // resolve files from /script and /pages
      includeList: {
        ...pagesList,
        ...scriptsList,
        ...publicList
      }
    }).apply(compiler)

    // Generate a manifest file with all the assets we need
    new ManifestPlugin({
      browser,
      manifestPath,
      excludeList: publicList
    }).apply(compiler)

    // Get every field in manifest that allows an .html file
    new HtmlPlugin({
      manifestPath,
      include: allPages,
      exclude: [...allPublic, ...allScripts]
    }).apply(compiler)

    // Get all scripts (bg, content, sw) declared in manifest
    new ScriptsPlugin({
      manifestPath,
      includeList: {
        ...manifestFieldsData.scripts,
        ...specialFoldersData.scripts
      },
      excludeList: {
        ...specialFoldersData.public,
        ...specialFoldersData.pages
      }
    }).apply(compiler)

    // Get locales
    new LocalesPlugin({manifestPath}).apply(compiler)

    // Grab all JSON assets from manifest except _locales
    new JsonPlugin({
      manifestPath,
      exclude: allPublic
    }).apply(compiler)

    // Grab all icon assets from manifest including popup icons
    new IconsPlugin({
      manifestPath,
      exclude: allPublic
    }).apply(compiler)

    // Grab all resources from script files
    // (background, content_scripts, service_worker)
    // and add them to the assets bundle.
    new ResourcesPlugin({
      manifestPath,
      exclude: allPublic
    }).apply(compiler)

    // Plugin to add special folders (public, pages, scripts) to the extension
    new SpecialFoldersPlugin({
      manifestPath
    }).apply(compiler)
  }
}
