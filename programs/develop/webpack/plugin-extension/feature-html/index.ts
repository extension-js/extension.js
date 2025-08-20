import * as path from 'path'
import {type Compiler} from '@rspack/core'
import {type FilepathList, type PluginInterface} from '../../webpack-types'
import {EmitHtmlFile} from './steps/emit-html-file'
import {AddAssetsToCompilation} from './steps/add-assets-to-compilation'
import {AddScriptsAndStylesToCompilation} from './steps/add-scripts-and-styles-to-compilation'
import {UpdateHtmlFile} from './steps/update-html-file'
import {AddToFileDependencies} from './steps/add-to-file-dependencies'
import {ThrowIfRecompileIsNeeded} from './steps/throw-if-recompile-is-needed'
import {HandleCommonErrors} from './steps/handle-common-errors'
import {DevOptions} from '../../../module'

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
export class HtmlPlugin {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList
  private readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = options.excludeList
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler): void {
    // 1 - Gets the original HTML file and add the HTML file to the compilation.
    new EmitHtmlFile({
      manifestPath: this.manifestPath,
      includeList: this.includeList,
      excludeList: this.excludeList,
      browser: this.browser
    }).apply(compiler)

    // 2 - Adds the assets within the HTML file to the compilation,
    // such as <img>, <iframe>, <link>, <script> etc.
    new AddAssetsToCompilation({
      manifestPath: this.manifestPath,
      includeList: this.includeList,
      excludeList: this.excludeList,
      browser: this.browser
    }).apply(compiler)

    // 3 - Adds the scripts and stylesheets within the HTML file
    // to the compilation.
    new AddScriptsAndStylesToCompilation({
      manifestPath: this.manifestPath,
      includeList: this.includeList,
      excludeList: this.excludeList,
      browser: this.browser
    }).apply(compiler as any)

    // 4 - Updates the HTML file with the new assets and entrypoints.
    new UpdateHtmlFile({
      manifestPath: this.manifestPath,
      includeList: this.includeList,
      excludeList: this.excludeList,
      browser: this.browser
    }).apply(compiler)

    // 5 - Ensure scripts within the HTML file are HMR enabled (development only).
    if ((compiler.options.mode || 'development') !== 'production') {
      compiler.options.module.rules.push({
        test: /\.(js|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
        include: [path.dirname(this.manifestPath)],
        exclude: [/([\\/])node_modules\1/],
        use: [
          {
            loader: path.resolve(__dirname, 'ensure-hmr-for-scripts'),
            options: {
              manifestPath: this.manifestPath,
              includeList: this.includeList,
              excludeList: this.excludeList,
              browser: this.browser
            }
          }
        ]
      })
    }

    // 6 - Ensure HTML file is recompiled upon changes.
    new AddToFileDependencies({
      manifestPath: this.manifestPath,
      includeList: this.includeList,
      excludeList: this.excludeList,
      browser: this.browser
    }).apply(compiler)

    // 7 - Suggest user to recompile if any style
    // or script path within the HTML file has changed.
    // This is needed because when can't recompile
    // entrypoints at runtime.
    new ThrowIfRecompileIsNeeded({
      manifestPath: this.manifestPath,
      includeList: this.includeList,
      excludeList: this.excludeList,
      browser: this.browser
    }).apply(compiler)

    // 8 - Handle common errors.
    new HandleCommonErrors({
      manifestPath: this.manifestPath,
      includeList: this.includeList,
      excludeList: this.excludeList,
      browser: this.browser
    }).apply(compiler)
  }
}
