// ██╗    ██╗ █████╗ ███████╗███╗   ███╗
// ██║    ██║██╔══██╗██╔════╝████╗ ████║
// ██║ █╗ ██║███████║███████╗██╔████╔██║
// ██║███╗██║██╔══██║╚════██║██║╚██╔╝██║
// ╚███╔███╔╝██║  ██║███████║██║ ╚═╝ ██║
//  ╚══╝╚══╝ ╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {type Compiler} from '@rspack/core'
import type {PluginInterface, DevOptions} from '../types'

export class WasmPlugin {
  public static readonly name: string = 'plugin-wasm'
  public readonly manifestPath: string
  public readonly mode: DevOptions['mode']

  constructor(options: PluginInterface & {mode: DevOptions['mode']}) {
    this.manifestPath = options.manifestPath
    this.mode = options.mode
  }

  private resolveAssetPath(projectRoot: string, relativePath: string) {
    const candidates = [
      path.join(projectRoot, 'node_modules', relativePath),
      path.join(process.cwd(), 'node_modules', relativePath)
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
    return null
  }

  private buildAssetAliases(projectRoot: string) {
    const aliases: Record<string, string> = {}
    const addAlias = (request: string, relativePath: string) => {
      const resolved = this.resolveAssetPath(projectRoot, relativePath)
      if (resolved) {
        aliases[request] = resolved
      }
    }

    addAlias(
      '@ffmpeg/core/dist/esm/ffmpeg-core.js',
      '@ffmpeg/core/dist/esm/ffmpeg-core.js'
    )
    addAlias(
      '@ffmpeg/core/dist/esm/ffmpeg-core.wasm',
      '@ffmpeg/core/dist/esm/ffmpeg-core.wasm'
    )
    addAlias(
      '@ffmpeg/core-mt/dist/esm/ffmpeg-core.js',
      '@ffmpeg/core-mt/dist/esm/ffmpeg-core.js'
    )
    addAlias(
      '@ffmpeg/core-mt/dist/esm/ffmpeg-core.wasm',
      '@ffmpeg/core-mt/dist/esm/ffmpeg-core.wasm'
    )
    addAlias(
      '@ffmpeg/core-mt/dist/esm/ffmpeg-core.worker.js',
      '@ffmpeg/core-mt/dist/esm/ffmpeg-core.worker.js'
    )
    addAlias(
      '@imagemagick/magick-wasm/magick.wasm',
      '@imagemagick/magick-wasm/magick.wasm'
    )
    addAlias(
      'tesseract-wasm/dist/tesseract-worker.js',
      'tesseract-wasm/dist/tesseract-worker.js'
    )
    addAlias(
      'tesseract-wasm/dist/tesseract-core.wasm',
      'tesseract-wasm/dist/tesseract-core.wasm'
    )

    return aliases
  }

  private ensureWasmResolution(compiler: Compiler, projectRoot: string) {
    compiler.options.resolve = compiler.options.resolve || {}
    const extensions = compiler.options.resolve.extensions || []
    if (!extensions.includes('.wasm')) {
      compiler.options.resolve.extensions = [...extensions, '.wasm']
    }

    const assetAliases = this.buildAssetAliases(projectRoot)
    compiler.options.resolve.alias = {
      ...assetAliases,
      ...(compiler.options.resolve.alias as any)
    }
  }

  private ensureWasmExperiments(compiler: Compiler) {
    compiler.options.experiments = {
      ...compiler.options.experiments,
      // Keep wasm async module support on; required by updated wasm spec.
      asyncWebAssembly: true
    }
  }

  public apply(compiler: Compiler): void {
    const projectRoot = String(compiler.options.context || process.cwd())
    this.ensureWasmExperiments(compiler)
    this.ensureWasmResolution(compiler, projectRoot)
  }
}
