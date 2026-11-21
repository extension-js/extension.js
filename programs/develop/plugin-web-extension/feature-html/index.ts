// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Compiler} from '@rspack/core'
import type {DevOptions, FilepathList, PluginInterface} from '../../types'
import {htmlPagesExtensionsFor} from '../shared/html-page-extensions'
import {emitRootAbsoluteRefsWith} from '../shared/root-absolute-refs-emitter'
import {AddAssetsToCompilation} from './steps/add-assets-to-compilation'
import {AddScriptsAndStylesToCompilation} from './steps/add-scripts-and-styles-to-compilation'
import {AddToFileDependencies} from './steps/add-to-file-dependencies'
import {EmitHtmlFile} from './steps/emit-html-file'
import {emitRootAbsoluteRefs} from './steps/emit-root-absolute-refs'
import {HandleCommonErrors} from './steps/handle-common-errors'
import {ThrowIfRecompileIsNeeded} from './steps/throw-if-recompile-is-needed'
import {UpdateHtmlFile} from './steps/update-html-file'

export class HtmlPlugin {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  private readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler): void {
    const includeList = {
      ...(this.includeList || {})
    }

    // The public copier runs this late, once the pages and sheets exist.
    emitRootAbsoluteRefsWith(compiler, emitRootAbsoluteRefs)

    new EmitHtmlFile({
      manifestPath: this.manifestPath,
      includeList,
      browser: this.browser
    }).apply(compiler)

    new AddAssetsToCompilation({
      manifestPath: this.manifestPath,
      includeList,
      browser: this.browser
    }).apply(compiler)

    const declared = new AddScriptsAndStylesToCompilation({
      manifestPath: this.manifestPath,
      includeList,
      browser: this.browser
    })

    declared.apply(compiler)

    new UpdateHtmlFile({
      manifestPath: this.manifestPath,
      includeList,
      browser: this.browser
    }).apply(compiler)

    // Another plugin may add to the pages here, where their entries exist
    // and no later step of this one has registered anything yet.
    for (const extension of htmlPagesExtensionsFor(compiler)) {
      extension.pagesDeclared(compiler, declared.pages)
    }

    new AddToFileDependencies({
      manifestPath: this.manifestPath,
      includeList,
      browser: this.browser
    }).apply(compiler)

    // Suggest recompiling when a style or script path inside the HTML changed;
    // entrypoints can't be recompiled at runtime.
    new ThrowIfRecompileIsNeeded({
      manifestPath: this.manifestPath,
      includeList,
      browser: this.browser
    }).apply(compiler)

    new HandleCommonErrors({
      manifestPath: this.manifestPath,
      includeList,
      browser: this.browser
    }).apply(compiler)
  }
}
