// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import {Compiler} from 'webpack'
import {getManifestFieldsData} from './data/manifest-fields'
import {getSpecialFoldersData} from './data/special-folders'

// Plugins
import {ResolvePlugin} from './feature-resolve'
import {ManifestPlugin} from './feature-manifest'
import {HtmlPlugin} from './feature-html'
import {ScriptsPlugin} from './feature-scripts'
import {LocalesPlugin} from './feature-locales'
import {JsonPlugin} from './feature-json'
import {IconsPlugin} from './feature-icons'
import {WebResourcesPlugin} from './feature-web-resources'
import {SpecialFoldersPlugin} from './feature-special-folders'

import {PluginInterface, FilepathList} from '../webpack-types'

import {DevOptions} from '../../commands/dev'
import {isUsingReact} from '../plugin-js-frameworks/js-tools/react'
import {isUsingPreact} from '../plugin-js-frameworks/js-tools/preact'
import {isUsingTypeScript} from '../plugin-js-frameworks/js-tools/typescript'
import {isUsingVue} from '../plugin-js-frameworks/js-tools/vue'

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
    const manifestFieldsData = getManifestFieldsData({manifestPath})
    const specialFoldersData = getSpecialFoldersData({manifestPath})

    process.env.EXPERIMENTAL_EXTENSION_RESOLVER_PLUGIN === 'true' &&
      new ResolvePlugin({
        manifestPath,
        browser: this.browser,
        includeList: {
          ...(specialFoldersData?.pages || {}),
          ...(specialFoldersData?.scripts || {})
        },
        excludeList: specialFoldersData.public,
        loaderOptions: {
          jsx:
            isUsingReact(path.dirname(this.manifestPath)) ||
            isUsingPreact(path.dirname(this.manifestPath)) ||
            isUsingVue(path.dirname(this.manifestPath)),
          typescript: isUsingTypeScript(path.dirname(this.manifestPath)),
          minify: compiler.options.mode === 'production'
        }
      }).apply(compiler)

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
      },
      excludeList: specialFoldersData.public
    }).apply(compiler)

    // Plugin to add special folders (public, pages, scripts) to the extension
    new SpecialFoldersPlugin({
      manifestPath
    }).apply(compiler)
  }
}
