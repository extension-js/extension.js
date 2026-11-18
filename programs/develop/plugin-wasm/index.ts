// ██╗    ██╗ █████╗ ███████╗███╗   ███╗
// ██║    ██║██╔══██╗██╔════╝████╗ ████║
// ██║ █╗ ██║███████║███████╗██╔████╔██║
// ██║███╗██║██╔══██║╚════██║██║╚██╔╝██║
// ╚███╔███╔╝██║  ██║███████║██║ ╚═╝ ██║
//  ╚══╝╚══╝ ╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import type {DevOptions, PluginInterface} from '../types'

export class WasmPlugin {
  public static readonly name: string = 'plugin-wasm'

  // biome-ignore lint/complexity/noUselessConstructor: rspack-config.ts passes the shared options, nothing here reads them
  constructor(_options?: PluginInterface & {mode?: DevOptions['mode']}) {}

  // Walk ancestors so hoisted workspace deps resolve the same way rspack's
  // `resolve.modules: ['node_modules']` does. Checking only the package dir
  // and cwd misses packages pnpm/yarn/npm hoist to the workspace root.
  private collectSearchRoots(projectRoot: string, cwd: string) {
    const roots: string[] = []
    const seen = new Set<string>()

    const addAncestors = (startDir: string) => {
      let current = path.resolve(startDir)

      while (true) {
        if (!seen.has(current)) {
          seen.add(current)
          roots.push(current)
        }

        const parent = path.dirname(current)
        if (parent === current) break

        current = parent
      }
    }

    addAncestors(projectRoot)
    addAncestors(cwd)

    return roots
  }

  private resolveAssetPath(
    projectRoot: string,
    cwd: string,
    relativePath: string
  ) {
    for (const root of this.collectSearchRoots(projectRoot, cwd)) {
      const candidate = path.join(root, 'node_modules', relativePath)

      if (fs.existsSync(candidate)) {
        return candidate
      }
    }

    return null
  }

  private buildAssetAliases(projectRoot: string, cwd: string) {
    const aliases: Record<string, string> = {}

    const addAlias = (request: string) => {
      const resolved = this.resolveAssetPath(projectRoot, cwd, request)

      if (resolved) {
        aliases[request] = resolved
      }
    }

    addAlias('@ffmpeg/core/dist/esm/ffmpeg-core.js')
    addAlias('@ffmpeg/core/dist/esm/ffmpeg-core.wasm')
    addAlias('@ffmpeg/core-mt/dist/esm/ffmpeg-core.js')
    addAlias('@ffmpeg/core-mt/dist/esm/ffmpeg-core.wasm')
    addAlias('@ffmpeg/core-mt/dist/esm/ffmpeg-core.worker.js')
    addAlias('@imagemagick/magick-wasm/magick.wasm')
    addAlias('tesseract-wasm/dist/tesseract-worker.js')
    addAlias('tesseract-wasm/dist/tesseract-core.wasm')

    return aliases
  }

  private ensureWasmResolution(
    compiler: Compiler,
    projectRoot: string,
    cwd: string
  ) {
    compiler.options.resolve = compiler.options.resolve || {}
    const extensions = compiler.options.resolve.extensions || []

    if (!extensions.includes('.wasm')) {
      compiler.options.resolve.extensions = [...extensions, '.wasm']
    }

    const assetAliases = this.buildAssetAliases(projectRoot, cwd)
    compiler.options.resolve.alias = {
      ...assetAliases,
      ...(compiler.options.resolve.alias as Record<
        string,
        string | false | string[]
      >)
    }
  }

  // rspack calls apply(compiler), so `cwd` is the process folder outside specs.
  public apply(compiler: Compiler, cwd: string = process.cwd()): void {
    const projectRoot = String(compiler.options.context || cwd)
    this.ensureWasmResolution(compiler, projectRoot, cwd)
  }
}
