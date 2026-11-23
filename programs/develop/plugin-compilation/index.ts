//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import type {Compiler, WebpackError} from '@rspack/core'
import CaseSensitivePathsPlugin from 'case-sensitive-paths-webpack-plugin'
import {forgetManifestReadsPerCompilation} from '../lib/manifest/source-manifest'
import {debugLine, isDebug} from '../lib/messaging'
import type {PluginInterface} from '../types'
import {BoringPlugin} from './boring'
import * as messages from './compilation-lib/messages'
import {setupCompilerDoneDiagnostics} from './done-diagnostics'
import {EnvPlugin} from './env'
import {FileRequestsPlugin} from './resolve-file-requests'
import {WarmAncestorWatchersPlugin} from './warm-ancestor-watchers'
import {WatchProjectConfigPlugin} from './watch-project-config'
import {WatchRealProjectPathPlugin} from './watch-real-project-path'
import {ZipPlugin} from './zip'

export class CompilationPlugin {
  public static readonly name: string = 'plugin-compilation'

  public readonly manifestPath: string
  public readonly browser: PluginInterface['browser']
  public readonly zip?: boolean
  public readonly zipSource?: boolean
  public readonly zipFilename?: string
  public readonly zipDir?: string
  public readonly session?: PluginInterface['session']
  public readonly command?: 'dev' | 'start' | 'preview' | 'build'
  public readonly define?: Record<string, unknown>
  public readonly browserLaunchEnabled?: boolean

  constructor(
    options: PluginInterface & {
      zip?: boolean
      zipSource?: boolean
      zipFilename?: string
      zipDir?: string
      command?: 'dev' | 'start' | 'preview' | 'build'
      define?: Record<string, unknown>
      browserLaunchEnabled?: boolean
    }
  ) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.define = options.define
    this.zip = options.zip
    this.zipSource = options.zipSource
    this.zipFilename = options.zipFilename
    this.zipDir = options.zipDir
    this.session = options.session
    this.command = options.command
    this.browserLaunchEnabled = options.browserLaunchEnabled
  }

  private applyIgnoreWarnings(compiler: Compiler): void {
    const existing = compiler.options.ignoreWarnings
    const ignoreWarnings = Array.isArray(existing)
      ? [...existing]
      : existing
        ? [existing]
        : []

    // Rspack after 2.3.3 renames the expression warning (rspack#16771), so
    // both texts stay listed while either version can run.
    const SUPPRESSED_THIRD_PARTY_WARNINGS = [
      'Critical dependency: the request of a dependency is an expression',
      'Dynamic module path: Rspack cannot determine which modules to bundle because the path is unknown at build time',
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
    forgetManifestReadsPerCompilation(compiler)
    this.applyIgnoreWarnings(compiler)

    new CaseSensitivePathsPlugin().apply(
      compiler as unknown as Parameters<CaseSensitivePathsPlugin['apply']>[0]
    )

    new EnvPlugin({
      manifestPath: this.manifestPath,
      browser: this.browser || 'chrome',
      define: this.define
    }).apply(compiler)

    new FileRequestsPlugin().apply(compiler)

    // The config file is read before the compiler exists and its values are a
    // session-scoped snapshot, so a watch run can only report the edit. Each
    // of these acts only once compiler.watch() runs, so a build passes them by.
    new WatchProjectConfigPlugin(
      (compiler.options.context as string) || path.dirname(this.manifestPath)
    ).apply(compiler)

    new WatchRealProjectPathPlugin().apply(compiler)
    new WarmAncestorWatchersPlugin().apply(compiler)

    // A zip is a shippable artifact: any build command may produce one,
    // production or a development-mode staging build alike. Only the dev
    // session, which serves from disk, never packages.
    if ((this.zip || this.zipSource) && this.command !== 'dev') {
      new ZipPlugin({
        manifestPath: this.manifestPath,
        browser: this.browser || 'chrome',
        zipData: {
          zip: this.zip,
          zipSource: this.zipSource,
          zipFilename: this.zipFilename,
          zipDir: this.zipDir
        }
      }).apply(compiler)
    } else {
      if (isDebug()) {
        const reason =
          this.command === 'dev'
            ? 'a dev session never packages'
            : 'zip disabled'
        debugLine(messages.zipPackagingSkipped(reason))
      }
    }

    // The build path renders errors and warnings once through the stats
    // handler in command-build, so only dev keeps this raw renderer.
    const diagnosticsFollow =
      this.command === 'build' || this.command === 'start'

    // Tapped first, so the compile line comes after the findings it counts.
    if (!diagnosticsFollow) {
      setupCompilerDoneDiagnostics(
        compiler,
        this.session?.port,
        this.manifestPath
      )
    }

    new BoringPlugin({
      manifestPath: this.manifestPath,
      browser: this.browser || 'chrome',
      browserLaunchEnabled: this.browserLaunchEnabled,
      diagnosticsFollow
    }).apply(compiler)
  }
}
