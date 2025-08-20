// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import {Compiler} from '@rspack/core'
import {getManifestFieldsData} from './data/manifest-fields'
import {getSpecialFoldersData} from './data/special-folders'

// Plugins
import {ManifestPlugin} from './feature-manifest'
import {HtmlPlugin} from './feature-html'
import {ScriptsPlugin} from './feature-scripts'
import {LocalesPlugin} from './feature-locales'
import {JsonPlugin} from './feature-json'
import {IconsPlugin} from './feature-icons'
import {WebResourcesPlugin} from './feature-web-resources'
import {SpecialFoldersPlugin} from './feature-special-folders'

// Types
import {PluginInterface, FilepathList} from '../webpack-types'
import {DevOptions} from '../../commands/commands-lib/config-types'

export class ExtensionPlugin {
  public static readonly name: string = 'plugin-extension'

  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler): void {
    const manifestPath = this.manifestPath
    const manifestFieldsData = getManifestFieldsData({
      manifestPath,
      browser: this.browser
    })
    const specialFoldersData = getSpecialFoldersData({
      manifestPath,
      browser: this.browser
    })

    // Generate a manifest file with all the assets we need
    new ManifestPlugin({
      browser: this.browser,
      manifestPath,
      includeList: {
        ...manifestFieldsData.html,
        ...(manifestFieldsData.icons as FilepathList),
        ...manifestFieldsData.json,
        ...manifestFieldsData.scripts
      },
      excludeList: specialFoldersData.public
    }).apply(compiler)

    // Get every field in manifest that allows an .html file
    new HtmlPlugin({
      manifestPath,
      browser: this.browser,
      includeList: {
        ...manifestFieldsData.html,
        ...specialFoldersData.pages
      },
      excludeList: {
        ...specialFoldersData.public,
        ...specialFoldersData.scripts
      }
    }).apply(compiler)

    // Get all scripts (bg, content, sw) declared in manifest
    new ScriptsPlugin({
      manifestPath,
      browser: this.browser,
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
    new LocalesPlugin({
      manifestPath
    }).apply(compiler)

    // Grab all JSON assets from manifest except _locales
    new JsonPlugin({
      manifestPath,
      includeList: manifestFieldsData.json,
      excludeList: specialFoldersData.public
    }).apply(compiler)

    // Grab all icon assets from manifest including popup icons
    new IconsPlugin({
      manifestPath,
      includeList: manifestFieldsData.icons as FilepathList,
      excludeList: specialFoldersData.public
    }).apply(compiler)

    // Grab all resources from script files
    // (background, content_scripts, service_worker)
    // and add them to the assets bundle.
    new WebResourcesPlugin({
      manifestPath,
      includeList: {
        ...manifestFieldsData.scripts,
        ...specialFoldersData.scripts
      }
    }).apply(compiler)

    // Plugin to add special folders (public, pages, scripts) to the extension
    new SpecialFoldersPlugin({
      manifestPath
    }).apply(compiler)
  }
}
