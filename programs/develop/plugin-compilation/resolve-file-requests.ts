//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'

interface ResolveRequest {
  context?: unknown
  request?: unknown
}

export interface FileRequestsOptions {
  isFile?: (target: string) => boolean
  platform?: NodeJS.Platform
}

function isExistingFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile()
  } catch {
    return false
  }
}

// The resolver tries every `resolve.roots` folder before a path that is
// already whole, and each try becomes a watched path that can never exist.
export class FileRequestsPlugin {
  public static readonly name: string = 'plugin-compilation:file-requests'

  private readonly isFile: (target: string) => boolean
  private readonly platform: NodeJS.Platform

  constructor(options: FileRequestsOptions = {}) {
    this.isFile = options.isFile ?? isExistingFile
    this.platform = options.platform ?? process.platform
  }

  // Returns the folder and the relative request that name the same file, or
  // nothing when the request is not a whole path to a file on disk.
  public rewrite(
    request: string
  ): {context: string; request: string} | undefined {
    // Loader syntax and fragments are left to the resolver.
    if (!request || request.includes('!') || request.includes('#')) {
      return undefined
    }

    const queryAt = request.indexOf('?')
    const file = queryAt === -1 ? request : request.slice(0, queryAt)
    const query = queryAt === -1 ? '' : request.slice(queryAt)

    if (!path.isAbsolute(file) || !this.isFile(file)) return undefined

    // The folder stays as spelled. A real path here would rename the module
    // and move its id, most of all where a short name stands for a long one.
    return {
      context: path.dirname(file),
      request: `./${path.basename(file)}${query}`
    }
  }

  public apply(compiler: Compiler): void {
    // A stand-in compiler without a module factory resolves nothing.
    if (typeof compiler.hooks?.normalModuleFactory?.tap !== 'function') return
    // A drive path is never tried under the roots, so nothing is gained there.
    if (this.platform === 'win32') return

    compiler.hooks.normalModuleFactory.tap(FileRequestsPlugin.name, (nmf) => {
      nmf.hooks.beforeResolve.tap(
        FileRequestsPlugin.name,
        (data: ResolveRequest) => {
          // Only a watcher pays for the tries. A one-off build is left alone.
          if (!compiler.watchMode) return

          const rewritten = this.rewrite(String(data?.request || ''))

          if (!rewritten) return

          data.context = rewritten.context
          data.request = rewritten.request
        }
      )
    })
  }
}
