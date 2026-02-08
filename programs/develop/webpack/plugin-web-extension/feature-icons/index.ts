// ██╗ ██████╗ ██████╗ ███╗   ██╗███████╗
// ██║██╔════╝██╔═══██╗████╗  ██║██╔════╝
// ██║██║     ██║   ██║██╔██╗ ██║███████╗
// ██║██║     ██║   ██║██║╚██╗██║╚════██║
// ██║╚██████╗╚██████╔╝██║ ╚████║███████║
// ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {type Compiler} from '@rspack/core'
import * as messages from './messages'
import {EmitFile} from './steps/emit-file'
import {AddToFileDependencies} from './steps/add-to-file-dependencies'
import {ThrowIfManifestIconsChange} from './steps/throw-if-manifest-icons-change'
import {normalizeIconIncludeKeys} from './normalize-keys'
import type {
  ThemeIcon,
  FilepathList,
  PluginInterface
} from '../../webpack-types'

/**
 * IconsPlugin is responsible for handling the icon files defined
 * in the manifest.json. It emits the icon files to the output
 * directory and adds them to the file dependencies of the compilation.
 *
 * Features supported:
 * action.default_icon
 * browser_action.default_icon
 * icons
 * page_action.default_icon
 * sidebar_action.default_icon
 */
export class IconsPlugin {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList | {[x: string]: ThemeIcon}

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
  }
  public apply(compiler: Compiler): void {
    // Normalize include keys so downstream steps can consistently
    // determine output folders and severities without relying on callers.
    const normalizedIncludeList = normalizeIconIncludeKeys(
      this.includeList as Record<string, unknown> | undefined
    )

    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      const beforeKeys = Object.keys(
        (this.includeList as Record<string, unknown>) || {}
      )
      const afterKeys = Object.keys(normalizedIncludeList || {})
      const changedCount = afterKeys.filter(
        (k) => k.includes('/default_icon') || k.includes('/theme_icons')
      ).length
      console.log(
        messages.iconsNormalizationSummary(beforeKeys, afterKeys, changedCount)
      )
    }

    new EmitFile({
      manifestPath: this.manifestPath,
      includeList: normalizedIncludeList
    }).apply(compiler)

    new AddToFileDependencies({
      manifestPath: this.manifestPath,
      includeList: normalizedIncludeList
    }).apply(compiler)

    new ThrowIfManifestIconsChange({
      manifestPath: this.manifestPath,
      includeList: normalizedIncludeList
    }).apply(compiler)
  }
}
