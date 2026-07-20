//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {type Compiler, DefinePlugin, type WebpackError} from '@rspack/core'
import CaseSensitivePathsPlugin from 'case-sensitive-paths-webpack-plugin'
import {setupCompilerDoneDiagnostics} from '../dev-server/compiler-hooks'
import type {PluginInterface} from '../types'
import {BoringPlugin} from './boring'
import {CleanDistFolderPlugin} from './clean-dist'
import * as messages from './compilation-lib/messages'
import {EnvPlugin} from './env'
import {ZipPlugin} from './zip'

export class CompilationPlugin {
  public static readonly name: string = 'plugin-compilation'

  public readonly manifestPath: string
  public readonly browser: PluginInterface['browser']
  public readonly clean: boolean
  public readonly zip?: boolean
  public readonly zipSource?: boolean
  public readonly zipFilename?: string
  public readonly port?: number

  constructor(
    options: PluginInterface & {clean: boolean} & {
      zip?: boolean
      zipSource?: boolean
      zipFilename?: string
      port?: number
    }
  ) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.clean = options.clean ?? true
    this.zip = options.zip
    this.zipSource = options.zipSource
    this.zipFilename = options.zipFilename
    this.port = options.port
  }

  private applyIgnoreWarnings(compiler: Compiler): void {
    const existing = compiler.options.ignoreWarnings
    const ignoreWarnings = Array.isArray(existing)
      ? [...existing]
      : existing
        ? [existing]
        : []

    const SUPPRESSED_THIRD_PARTY_WARNINGS = [
      'Critical dependency: the request of a dependency is an expression',
      'Critical dependency: require function is used in a way in which dependencies cannot be statically extracted',
      'Accessing import.meta directly is unsupported'
    ]
    ignoreWarnings.push((warning) => {
      const w = warning as InstanceType<typeof WebpackError> & {
        module?: {resource?: unknown; userRequest?: unknown}
      }
      try {
        const message = String((w && (w.message || w)) || '')
        const modulePath = String(
          (w?.module && (w.module.resource || w.module.userRequest)) || ''
        )
        const isThirdParty = /[\\/]node_modules[\\/]/.test(modulePath)
        if (!isThirdParty) return false

        return SUPPRESSED_THIRD_PARTY_WARNINGS.some((needle) =>
          message.includes(needle)
        )
      } catch {
        return false
      }
    })

    compiler.options.ignoreWarnings = ignoreWarnings
  }

  public apply(compiler: Compiler): void {
    this.applyIgnoreWarnings(compiler)

    new CaseSensitivePathsPlugin().apply(
      compiler as unknown as Parameters<CaseSensitivePathsPlugin['apply']>[0]
    )

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

    // Define NODE_ENV when running under a real Rspack compiler.
    // (Unit tests often pass a lightweight compiler stub that doesn't expose
    // Rspack internals required by builtin plugins.)
    try {
      const hasRspackInternals =
        typeof (compiler as {__internal__registerBuiltinPlugin?: unknown})
          .__internal__registerBuiltinPlugin === 'function'
      if (hasRspackInternals) {
        new DefinePlugin({
          'process.env.NODE_ENV': JSON.stringify(
            compiler.options.mode || 'development'
          )
        }).apply(compiler)
      }
    } catch {
      // ignore
    }

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

    // Register warning/error stats output before browser-runner done hooks.
    // This keeps aggregated diagnostics visible before launch-related logs.
    setupCompilerDoneDiagnostics(compiler, this.port)
  }
}
