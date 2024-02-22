import path from 'path'
import type webpack from 'webpack'

import {type IncludeList, type HtmlPluginInterface} from './types'
import EmitHtmlFile from './steps/EmitHtmlFile'
import AddAssetsToCompilation from './steps/AddAssetsToCompilation'
import AddScriptsAndStylesToCompilation from './steps/AddScriptsAndStylesToCompilation'
import UpdateHtmlFile from './steps/UpdateHtmlFile'
import EnsureHMRForScripts from './steps/EnsureHMRForScripts'
import AddToFileDependencies from './steps/AddToFileDependencies'
import ThrowIfRecompileIsNeeded from './steps/ThrowIfRecompileIsNeeded'
import HandleCommonErrors from './steps/HandleCommonErrors'
import getAssetsFromHtml from './lib/getAssetsFromHtml'

/**
 * HtmlPlugin is responsible for handling the HTML file
 * defined in the manifest.json. Static assets and CSS files
 * within the HTML file are added to the compilation. JS files
 * are added as webpack entrypoints. It also supports ecxtra
 * html files defined via this.include option. These extra
 * html files are added to the compilation and are also HMR
 * enabled. They are useful for adding extra pages to the
 * extension runtime that are not defined in manifest.
 *
 * The plugin also has a guard against recompiling entrypoints
 * at runtime, throwing an error if any of those files change.
 *
 * Features supported:
 * action.default_popup - HMR enabled
 * background.page - HMR enabled
 * chrome_settings_overrides.homepage - HMR enabled
 * chrome_url_overrides.newtab - HMR enabled
 * chrome_url_overrides.history - HMR enabled
 * chrome_url_overrides.bookmarks - HMR enabled
 * devtools_page - HMR enabled
 * options_ui.page - HMR enabled
 * page_action.default_popup - HMR enabled
 * sandbox.page - HMR enabled
 * side_panel.default_panel - HMR enabled
 * sidebar_action.default_panel - HMR enabled
 */
export default class HtmlPlugin {
  public readonly manifestPath: string
  public readonly include?: string[]
  public readonly exclude?: string[]

  constructor(options: HtmlPluginInterface) {
    this.manifestPath = options.manifestPath
    this.include = options.include || []
    this.exclude = options.exclude || []
  }

  private parseIncludes(includes: string[]): IncludeList {
    if (!includes.length) return {}
    return includes.reduce((acc, include) => {
      const extname = path.extname(include)
      const filename = path.basename(include, extname)

      return {
        ...acc,
        [`pages/${filename}`]: {html: include, ...getAssetsFromHtml(include)}
      }
    }, {})
  }

  public apply(compiler: webpack.Compiler): void {
    const includeList = this.parseIncludes(this.include || [])

    // 1 - Gets the original HTML file and add the HTML file to the compilation.
    new EmitHtmlFile({
      manifestPath: this.manifestPath,
      includeList,
      exclude: this.exclude || []
    }).apply(compiler)

    // 2 - Adds the assets within the HTML file to the compilation,
    // such as <img>, <iframe>, <link>, <script> etc.
    new AddAssetsToCompilation({
      manifestPath: this.manifestPath,
      includeList,
      exclude: this.exclude || []
    }).apply(compiler)

    // 3 - Adds the scripts and stylesheets within the HTML file
    // to the compilation.
    new AddScriptsAndStylesToCompilation({
      manifestPath: this.manifestPath,
      includeList,
      exclude: this.exclude || []
    }).apply(compiler)

    // 4 - Updates the HTML file with the new assets and entrypoints.
    new UpdateHtmlFile({
      manifestPath: this.manifestPath,
      includeList,
      exclude: this.exclude || []
    }).apply(compiler)

    // 5 - Ensure scripts within the HTML file are HMR enabled.
    new EnsureHMRForScripts({
      manifestPath: this.manifestPath,
      includeList,
      exclude: this.exclude || []
    }).apply(compiler)

    // 6 - Ensure HTML file is recompiled upon changes.
    new AddToFileDependencies({
      manifestPath: this.manifestPath,
      includeList,
      exclude: this.exclude || []
    }).apply(compiler)

    // 7 - Suggest user to recompile if any style
    // or script path within the HTML file has changed.
    // This is needed because when can't recompile
    // entrypoints at runtime.
    new ThrowIfRecompileIsNeeded({
      manifestPath: this.manifestPath,
      includeList,
      exclude: this.exclude || []
    }).apply(compiler)

    // 7 - Handle common errors.
    new HandleCommonErrors({
      manifestPath: this.manifestPath,
      includeList,
      exclude: this.exclude || []
    }).apply(compiler)
  }
}
