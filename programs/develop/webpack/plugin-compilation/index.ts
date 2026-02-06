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

  private applyIgnoreWarnings(compiler: Compiler): void {
    const existing = compiler.options.ignoreWarnings
    const ignoreWarnings = Array.isArray(existing)
      ? [...existing]
      : existing
        ? [existing]
        : []

    ignoreWarnings.push((warning: any) => {
      try {
        const message = String((warning && (warning.message || warning)) || '')
        const modulePath =
          (warning &&
            warning.module &&
            (warning.module.resource || warning.module.userRequest)) ||
          ''
        if (
          message.includes(
            'Critical dependency: the request of a dependency is an expression'
          ) &&
          /[\\\/]@ffmpeg[\\\/]ffmpeg[\\\/]dist[\\\/]esm[\\\/](classes|worker)\.js$/.test(
            modulePath
          )
        ) {
          return true
        }
        if (
          message.includes(
            'Critical dependency: the request of a dependency is an expression'
          ) &&
          /[\\\/]@techstark[\\\/]opencv-js[\\\/]dist[\\\/]opencv\.js$/.test(
            modulePath
          )
        ) {
          return true
        }
        if (
          message.includes(
            'Critical dependency: the request of a dependency is an expression'
          ) &&
          /[\\\/]@sqlite\.org[\\\/]sqlite-wasm[\\\/]dist[\\\/]sqlite3-worker1\.mjs$/.test(
            modulePath
          )
        ) {
          return true
        }
        return (
          message.includes('Accessing import.meta directly is unsupported') &&
          /[\\\/]@huggingface[\\\/]transformers[\\\/].*transformers\.web\.js$/.test(
            modulePath
          )
        )
      } catch {
        return false
      }
    })

    compiler.options.ignoreWarnings = ignoreWarnings
  }

  public apply(compiler: Compiler): void {
    this.applyIgnoreWarnings(compiler)

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

    // Define NODE_ENV when running under a real Rspack compiler.
    // (Unit tests often pass a lightweight compiler stub that doesn't expose
    // Rspack internals required by builtin plugins.)
    try {
      const hasRspackInternals =
        typeof (compiler as any).__internal__registerBuiltinPlugin ===
        'function'
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
  }
}
