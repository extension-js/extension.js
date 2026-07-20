// ██╗    ██╗███████╗██████╗       ███████╗██╗  ██╗████████╗███████╗███╗   ██╗███████╗██╗ ██████╗ ███╗   ██╗
// ██║    ██║██╔════╝██╔══██╗      ██╔════╝╚██╗██╔╝╚══██╔══╝██╔════╝████╗  ██║██╔════╝██║██╔═══██╗████╗  ██║
// ██║ █╗ ██║█████╗  ██████╔╝█████╗█████╗   ╚███╔╝    ██║   █████╗  ██╔██╗ ██║███████╗██║██║   ██║██╔██╗ ██║
// ██║███╗██║██╔══╝  ██╔══██╗╚════╝██╔══╝   ██╔██╗    ██║   ██╔══╝  ██║╚██╗██║╚════██║██║██║   ██║██║╚██╗██║
// ╚███╔███╔╝███████╗██████╔╝      ███████╗██╔╝ ██╗   ██║   ███████╗██║ ╚████║███████║██║╚██████╔╝██║ ╚████║
//  ╚══╝╚══╝ ╚══════╝╚═════╝       ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═══╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import type {Compiler} from '@rspack/core'
import {getManifestFieldsData} from 'browser-extension-manifest-fields'
// Business logic modules
import {getSpecialFoldersDataForCompiler} from '../plugin-special-folders/get-data'
// Types
import type {DevOptions, FilepathList, PluginInterface} from '../types'
import {HtmlPlugin} from './feature-html'
import {IconsPlugin} from './feature-icons'
import {JsonPlugin} from './feature-json'
import {LocalesPlugin} from './feature-locales'
// Plugins
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

    // Generate a manifest file with all the assets we need
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

    // Get every field in manifest that allows an .html file
    new HtmlPlugin({
      manifestPath,
      browser: this.browser,
      includeList: {
        ...manifestFieldsData.html,
        ...specialFoldersData.pages
      }
    }).apply(compiler)

    // Get all scripts (bg, content, sw) declared in manifest
    new ScriptsPlugin({
      manifestPath,
      browser: this.browser,
      includeList: {
        ...manifestFieldsData.scripts,
        ...specialFoldersData.scripts
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
      browser: this.browser
    }).apply(compiler)

    // Grab all icon assets from manifest including popup icons.
    // Theme images (`theme.images.*`, incl. the `additional_backgrounds`
    // array) ride the same emit path so their files are copied to
    // `theme/images/<basename>` — matching the paths the theme manifest
    // override writes into the output manifest.
    new IconsPlugin({
      manifestPath,
      includeList: {
        ...(manifestFieldsData.icons as FilepathList),
        ...(manifestFieldsData.theme as FilepathList)
      },
      browser: this.browser
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

    // Single unified manifest-fields change detector (dev only).
    // Replaces per-feature ThrowIf* plugins that each called
    // getManifestFieldsData() independently on every manifest save.
    new ManifestFieldsChangeDetector({
      manifestPath,
      browser: this.browser
    }).apply(compiler)
  }
}
