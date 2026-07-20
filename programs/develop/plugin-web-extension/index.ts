// ██╗    ██╗███████╗██████╗       ███████╗██╗  ██╗████████╗███████╗███╗   ██╗███████╗██╗ ██████╗ ███╗   ██╗
// ██║    ██║██╔════╝██╔══██╗      ██╔════╝╚██╗██╔╝╚══██╔══╝██╔════╝████╗  ██║██╔════╝██║██╔═══██╗████╗  ██║
// ██║ █╗ ██║█████╗  ██████╔╝█████╗█████╗   ╚███╔╝    ██║   █████╗  ██╔██╗ ██║███████╗██║██║   ██║██╔██╗ ██║
// ██║███╗██║██╔══╝  ██╔══██╗╚════╝██╔══╝   ██╔██╗    ██║   ██╔══╝  ██║╚██╗██║╚════██║██║██║   ██║██║╚██╗██║
// ╚███╔███╔╝███████╗██████╔╝      ███████╗██╔╝ ██╗   ██║   ███████╗██║ ╚████║███████║██║╚██████╔╝██║ ╚████║
//  ╚══╝╚══╝ ╚══════╝╚═════╝       ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═══╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Compiler} from '@rspack/core'
import {getManifestFieldsData} from 'browser-extension-manifest-fields'
import {getSpecialFoldersDataForCompiler} from '../plugin-special-folders/get-data'
import type {DevOptions, FilepathList, PluginInterface} from '../types'
import {HtmlPlugin} from './feature-html'
import {IconsPlugin} from './feature-icons'
import {JsonPlugin} from './feature-json'
import {LocalesPlugin} from './feature-locales'
import {ManifestPlugin} from './feature-manifest'
import {ScriptsPlugin} from './feature-scripts'
import {WebResourcesPlugin} from './feature-web-resources'
import {ManifestFieldsChangeDetector} from './shared/manifest-fields-change-detector'

export class WebExtensionPlugin {
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

    const specialFoldersData = getSpecialFoldersDataForCompiler(compiler)

    new ManifestPlugin({
      browser: this.browser,
      manifestPath,
      includeList: {
        ...manifestFieldsData.html,
        ...(manifestFieldsData.icons as FilepathList),
        ...manifestFieldsData.json,
        ...manifestFieldsData.scripts
      }
    }).apply(compiler)

    new HtmlPlugin({
      manifestPath,
      browser: this.browser,
      includeList: {
        ...manifestFieldsData.html,
        ...specialFoldersData.pages
      }
    }).apply(compiler)

    new ScriptsPlugin({
      manifestPath,
      browser: this.browser,
      includeList: {
        ...manifestFieldsData.scripts,
        ...specialFoldersData.scripts
      }
    }).apply(compiler)

    new LocalesPlugin({
      manifestPath
    }).apply(compiler)

    new JsonPlugin({
      manifestPath,
      includeList: manifestFieldsData.json,
      browser: this.browser
    }).apply(compiler)

    // Grab all icon assets from the manifest including popup icons; theme images
    // ride the same emit path so files land at theme/images/<basename>.
    new IconsPlugin({
      manifestPath,
      includeList: {
        ...(manifestFieldsData.icons as FilepathList),
        ...(manifestFieldsData.theme as FilepathList)
      },
      browser: this.browser
    }).apply(compiler)

    new WebResourcesPlugin({
      manifestPath,
      includeList: {
        ...manifestFieldsData.scripts,
        ...specialFoldersData.scripts
      }
    }).apply(compiler)

    // Single unified manifest-fields change detector (dev only); replaces
    // per-feature ThrowIf* plugins that each re-read manifest data per save.
    new ManifestFieldsChangeDetector({
      manifestPath,
      browser: this.browser
    }).apply(compiler)
  }
}
