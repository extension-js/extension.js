// ██╗    ██╗███████╗██████╗       ███████╗██╗  ██╗████████╗███████╗███╗   ██╗███████╗██╗ ██████╗ ███╗   ██╗
// ██║    ██║██╔════╝██╔══██╗      ██╔════╝╚██╗██╔╝╚══██╔══╝██╔════╝████╗  ██║██╔════╝██║██╔═══██╗████╗  ██║
// ██║ █╗ ██║█████╗  ██████╔╝█████╗█████╗   ╚███╔╝    ██║   █████╗  ██╔██╗ ██║███████╗██║██║   ██║██╔██╗ ██║
// ██║███╗██║██╔══╝  ██╔══██╗╚════╝██╔══╝   ██╔██╗    ██║   ██╔══╝  ██║╚██╗██║╚════██║██║██║   ██║██║╚██╗██║
// ╚███╔███╔╝███████╗██████╔╝      ███████╗██╔╝ ██╗   ██║   ███████╗██║ ╚████║███████║██║╚██████╔╝██║ ╚████║
//  ╚══╝╚══╝ ╚══════╝╚═════╝       ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═══╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {
  excludedFiles,
  isExcludedEntry,
  omitExcludedEntries
} from '../plugin-special-folders/folders-config'
import {getSpecialFoldersDataForCompiler} from '../plugin-special-folders/get-data'
import * as specialFoldersMessages from '../plugin-special-folders/messages'
import type {DevOptions, FilepathList, PluginInterface} from '../types'
import {HtmlPlugin} from './feature-html'
import {IconsPlugin} from './feature-icons'
import {omniboxIconFields} from './feature-icons/omnibox-fields'
import {themeImageFields} from './feature-icons/theme-image-fields'
import {JsonPlugin} from './feature-json'
import {LocalesPlugin} from './feature-locales'
import {ManifestPlugin} from './feature-manifest'
import {ScriptsPlugin} from './feature-scripts'
import {WebResourcesPlugin} from './feature-web-resources'
import {reportToCompilation} from './shared/compilation-issues'
import {htmlPageEntries} from './shared/html-page-entries'
import {getResolvedManifestFieldsData} from './shared/manifest-fields'
import {ManifestFieldsChangeDetector} from './shared/manifest-fields-change-detector'
import {
  settingsOverridesIconFields,
  themeExperimentStylesheetEntries
} from './shared/manifest-path-assets'

export class WebExtensionPlugin {
  public static readonly name: string = 'plugin-extension'

  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']
  public readonly devSession?: boolean
  public readonly define?: Record<string, unknown>

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.devSession = options.devSession
    this.define = options.define
  }

  public apply(compiler: Compiler): void {
    const manifestPath = this.manifestPath

    const projectPath = compiler.options?.context as string | undefined
    const manifestFieldsData = getResolvedManifestFieldsData({
      manifestPath,
      browser: this.browser,
      projectPath
    })

    const specialFoldersData = getSpecialFoldersDataForCompiler(compiler)

    // A file the `exclude` config leaves out of this browser's build gets no
    // entry anywhere, and a manifest field that still names it is an error:
    // the field would point at a file the output does not hold.
    const excluded = excludedFiles(projectPath)
    const forThisBuild = (list: FilepathList): FilepathList =>
      omitExcludedEntries(list, excluded)
    const manifestNamesExcluded = Object.values({
      ...manifestFieldsData.html,
      ...manifestFieldsData.scripts
    })
      .flatMap((value) => (Array.isArray(value) ? value : value ? [value] : []))
      .map(String)
      .filter((file) => isExcludedEntry(file, excluded))

    if (manifestNamesExcluded.length > 0) {
      compiler.hooks.thisCompilation.tap(
        WebExtensionPlugin.name,
        (compilation) => {
          for (const file of manifestNamesExcluded) {
            reportToCompilation(
              compilation,
              compiler,
              specialFoldersMessages.manifestNamesExcludedFile(
                path
                  .relative(projectPath || path.dirname(manifestPath), file)
                  .split(path.sep)
                  .join('/'),
                String(this.browser)
              ),
              'error',
              'manifest.json'
            )
          }
        }
      )
    }

    new ManifestPlugin({
      browser: this.browser,
      devSession: this.devSession,
      manifestPath,
      includeList: {
        ...manifestFieldsData.html,
        ...(manifestFieldsData.icons as FilepathList),
        ...manifestFieldsData.json,
        ...manifestFieldsData.scripts
      }
    }).apply(compiler)

    new HtmlPlugin({
      devSession: this.devSession,
      manifestPath,
      browser: this.browser,
      includeList: forThisBuild(
        htmlPageEntries({
          manifestPath,
          browser: this.browser,
          projectPath,
          mode: compiler.options.mode,
          manifestHtml: manifestFieldsData.html,
          manifestScripts: manifestFieldsData.scripts,
          specialFolderPages: specialFoldersData.pages
        })
      )
    }).apply(compiler)

    new ScriptsPlugin({
      manifestPath,
      browser: this.browser,
      devSession: this.devSession,
      define: this.define,
      includeList: forThisBuild({
        ...manifestFieldsData.scripts,
        ...specialFoldersData.scripts,
        ...themeExperimentStylesheetEntries(
          manifestPath,
          this.browser,
          projectPath
        )
      })
    }).apply(compiler)

    new LocalesPlugin({
      manifestPath,
      browser: this.browser
    }).apply(compiler)

    new JsonPlugin({
      manifestPath,
      includeList: manifestFieldsData.json,
      browser: this.browser
    }).apply(compiler)

    // Grab all icon assets from the manifest including popup icons; theme images
    // ride the same emit path and land under theme/images at their own path.
    new IconsPlugin({
      manifestPath,
      includeList: {
        ...(manifestFieldsData.icons as FilepathList),
        ...themeImageFields(manifestPath, this.browser),
        ...omniboxIconFields(manifestPath, this.browser),
        ...settingsOverridesIconFields(manifestPath, this.browser, projectPath)
      },
      browser: this.browser
    }).apply(compiler)

    new WebResourcesPlugin({
      manifestPath,
      includeList: forThisBuild({
        ...manifestFieldsData.scripts,
        ...specialFoldersData.scripts
      })
    }).apply(compiler)

    // Single unified manifest-fields change detector (dev only); replaces
    // per-feature ThrowIf* plugins that each re-read manifest data per save.
    new ManifestFieldsChangeDetector({
      manifestPath,
      browser: this.browser
    }).apply(compiler)
  }
}
