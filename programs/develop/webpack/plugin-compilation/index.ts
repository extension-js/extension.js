//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {Compiler, DefinePlugin} from '@rspack/core'
import CaseSensitivePathsPlugin from 'case-sensitive-paths-webpack-plugin'
import * as messages from './compilation-lib/messages'
import {EnvPlugin} from './env'
import {CleanDistFolderPlugin} from './clean-dist'
import {ZipPlugin} from './zip'
import {BoringPlugin} from './boring'

import {type PluginInterface} from '../webpack-types'

export class CompilationPlugin {
  public static readonly name: string = 'plugin-compilation'

  public readonly manifestPath: string
  public readonly browser: PluginInterface['browser']
  public readonly clean: boolean
  public readonly zip?: boolean
  public readonly zipSource?: boolean
  public readonly zipFilename?: string

  constructor(
    options: PluginInterface & {clean: boolean} & {
      zip?: boolean
      zipSource?: boolean
      zipFilename?: string
    }
  ) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.clean = options.clean ?? true
    this.zip = options.zip
    this.zipSource = options.zipSource
    this.zipFilename = options.zipFilename
  }

  public apply(compiler: Compiler): void {
    // TODO: This is outdated
    new CaseSensitivePathsPlugin().apply(compiler as any)

    new EnvPlugin({
      manifestPath: this.manifestPath,
      browser: this.browser || 'chrome'
    }).apply(compiler)

    // The CleanDistFolderPlugin will remove the dist folder
    // before the compilation starts. This is a problem
    // for preview mode, where we don't want to clean the
    // folder that is being used by the preview server.
    if (this.clean) {
      new CleanDistFolderPlugin({
        browser: this.browser || 'chrome'
      }).apply(compiler)
    }

    new DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify(
        compiler.options.mode || 'development'
      )
    })

    // Register packaging only for production builds when requested
    if (
      (this.zip || this.zipSource) &&
      compiler.options.mode === 'production'
    ) {
      new ZipPlugin({
        manifestPath: this.manifestPath,
        browser: this.browser || 'chrome',
        zipData: {
          zip: this.zip,
          zipSource: this.zipSource,
          zipFilename: this.zipFilename
        }
      }).apply(compiler)
    } else {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        const reason =
          compiler.options.mode !== 'production'
            ? 'not production mode'
            : 'zip disabled'
        console.log(messages.zipPackagingSkipped(reason))
      }
    }

    new BoringPlugin({
      manifestPath: this.manifestPath,
      browser: this.browser || 'chrome'
    }).apply(compiler)
  }
}
