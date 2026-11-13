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
  realpath?: (target: string) => string
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
  private readonly realpath: (target: string) => string
  private readonly folders = new Map<string, string>()

  constructor(options: FileRequestsOptions = {}) {
    this.isFile = options.isFile ?? isExistingFile
    this.realpath =
      options.realpath ?? (fs.realpathSync.native || fs.realpathSync)
  }

  private realFolder(folder: string): string {
    const known = this.folders.get(folder)

    if (known !== undefined) return known

    let real = folder

    try {
      real = this.realpath(folder)
    } catch {
      // A folder that can not be resolved is asked for as written.
    }

    this.folders.set(folder, real)

    return real
  }

  // Returns the folder and the relative request that name the same file, or
  // nothing when the request is not a whole path to a file on disk.
  public rewrite(
    request: string,
    followLinks: boolean
  ): {context: string; request: string} | undefined {
    // Loader syntax and fragments are left to the resolver.
    if (!request || request.includes('!') || request.includes('#')) {
      return undefined
    }

    const queryAt = request.indexOf('?')
    const file = queryAt === -1 ? request : request.slice(0, queryAt)
    const query = queryAt === -1 ? '' : request.slice(queryAt)

    if (!path.isAbsolute(file) || !this.isFile(file)) return undefined

    const folder = path.dirname(file)

    return {
      context: followLinks ? this.realFolder(folder) : folder,
      request: `./${path.basename(file)}${query}`
    }
  }

  public apply(compiler: Compiler): void {
    // A stand-in compiler without a module factory resolves nothing.
    if (typeof compiler.hooks?.normalModuleFactory?.tap !== 'function') return

    compiler.hooks.normalModuleFactory.tap(FileRequestsPlugin.name, (nmf) => {
      nmf.hooks.beforeResolve.tap(
        FileRequestsPlugin.name,
        (data: ResolveRequest) => {
          const rewritten = this.rewrite(
            String(data?.request || ''),
            compiler.options.resolve?.symlinks !== false
          )

          if (!rewritten) return

          data.context = rewritten.context
          data.request = rewritten.request
        }
      )
    })
  }
}
