import path from 'path'
import webpack from 'webpack'

import {type HtmlPluginInterface} from './types'
import AddHtmlFileToCompilation from './steps/AddHtmlFileToCompilation'
import AddAssetsToCompilation from './steps/AddAssetsToCompilation'
import AddScriptsAndStyles from './steps/AddScriptsAndStyles'
import EnsureHMRForScripts from './steps/EnsureHMRForScripts'
import AddToFileDependencies from './steps/AddToFileDependencies'
import ThrowIfRecompileIsNeeded from './steps/ThrowIfRecompileIsNeeded'
import HandleCommonErrors from './steps/HandleCommonErrors'

export default class HtmlPlugin {
  public readonly manifestPath: string
  public readonly pagesFolder?: string
  public readonly exclude?: string[]

  constructor(options: HtmlPluginInterface) {
    this.manifestPath = options.manifestPath
    this.pagesFolder = options.pagesFolder
      ? path.resolve(path.dirname(options.manifestPath), options.pagesFolder)
      : undefined
    this.exclude = options.exclude || []
  }

  public apply(compiler: webpack.Compiler): void {
    // This plugin:
    // 1 - Adds the HTML file to the compilation.
    new AddHtmlFileToCompilation({
      manifestPath: this.manifestPath,
      pagesFolder: this.pagesFolder,
      exclude: this.exclude
    }).apply(compiler)

    // 2 - Adds the assets within the HTML file to the compilation.
    new AddAssetsToCompilation({
      manifestPath: this.manifestPath,
      pagesFolder: this.pagesFolder,
      exclude: this.exclude
    }).apply(compiler)

    // 3 - Adds the scripts and stylesheets within the HTML file to the compilation.
    new AddScriptsAndStyles({
      manifestPath: this.manifestPath,
      pagesFolder: this.pagesFolder,
      exclude: this.exclude
    }).apply(compiler)

    // 4 - Ensure scripts within the HTML file are HMR enabled.
    new EnsureHMRForScripts({
      manifestPath: this.manifestPath,
      pagesFolder: this.pagesFolder,
      exclude: this.exclude
    }).apply(compiler)

    // 5 - Ensure HTML file is recompiled upon changes.
    new AddToFileDependencies({
      manifestPath: this.manifestPath,
      pagesFolder: this.pagesFolder,
      exclude: this.exclude
    }).apply(compiler)

    // 6 - Suggest user to recompile if any style
    // or script path within the HTML file has changed.
    // This is needed because when can't recompile
    // entrypoints at runtime.
    new ThrowIfRecompileIsNeeded({
      manifestPath: this.manifestPath,
      pagesFolder: this.pagesFolder,
      exclude: this.exclude
    }).apply(compiler)

    // 7 - Handle common errors.
    new HandleCommonErrors({
      manifestPath: this.manifestPath,
      pagesFolder: this.pagesFolder
    }).apply(compiler)
  }
}
