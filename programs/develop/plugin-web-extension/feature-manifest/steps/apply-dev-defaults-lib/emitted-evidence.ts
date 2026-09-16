// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import {experiments} from '@rspack/core'

// What the build really wrote, and which script a module ended up in. Every
// scan that reports on user code reads through here, so a per-browser branch
// the bundler folded away is never named as code that ships.

export interface EmittedModule {
  resource?: string
  modules?: Iterable<EmittedModule>
}

export interface EmittedChunk {
  files?: Iterable<string>
}

export interface EmittedCompilation {
  getAssets?: () => readonly {
    name: string
    source: {source(): string | Buffer}
  }[]
  chunkGraph?: {
    getModuleChunksIterable(module: EmittedModule): Iterable<EmittedChunk>
  }
}

const EMITTED_SCRIPT_RE = /\.[cm]?js$/
const MAX_SOURCE_BYTES = 1024 * 1024
const MAX_ASSET_BYTES = 16 * 1024 * 1024
const MAX_COMPRESS_BYTES = 4 * 1024 * 1024

// A development bundle keeps every build-time branch. The browser constant is
// substituted, so `"firefox" === 'safari'` sits right there in the script, but
// in development nothing folds it and nothing drops the code it guards, not
// even a function the dead branch is the only caller of. Compressing the
// script answers what a shipped build of this same code carries, which is the
// question a "you are missing a permission" warning is really asking.
export function shippableText(text: string): string {
  if (text.length > MAX_COMPRESS_BYTES) return text

  try {
    const compressed = experiments?.swc?.minifySync(text, {
      compress: true,
      // Mangling renames nothing a scan looks for, and leaving it off keeps
      // the compressed script readable when a scan result has to be explained.
      mangle: false
    })

    // A script whose every statement was dead compresses to the empty string,
    // which is a result, not a failure, so the type is what decides here.
    return typeof compressed?.code === 'string' ? compressed.code : text
  } catch {
    // A script the compressor cannot parse keeps its own text, so the scan
    // reads what is there and errs toward reporting rather than toward silence.
    return text
  }
}

export function readEmittedScripts(
  compilation: EmittedCompilation
): Map<string, string> {
  const scripts = new Map<string, string>()
  let assets: ReturnType<NonNullable<EmittedCompilation['getAssets']>>

  try {
    assets = compilation.getAssets?.() || []
  } catch {
    return scripts
  }

  for (const asset of assets) {
    if (!EMITTED_SCRIPT_RE.test(asset.name)) continue

    try {
      const raw = asset.source.source()
      const text = typeof raw === 'string' ? raw : raw.toString('utf-8')
      if (text.length > MAX_ASSET_BYTES) continue

      scripts.set(asset.name, text)
    } catch {
      // A source that can't be read is not a source the linter reads
    }
  }

  return scripts
}

export function readProjectSource(resource: string): string | undefined {
  try {
    if (fs.statSync(resource).size > MAX_SOURCE_BYTES) return undefined

    return fs.readFileSync(resource, 'utf-8')
  } catch {
    return undefined
  }
}

// The files a module was emitted into, or undefined when the chunk graph
// can't say. Production concatenates modules, so the graph is asked about
// the outer module while the source comes from the inner ones.
export function emittedFilesOf(
  compilation: EmittedCompilation,
  module: EmittedModule
): string[] | undefined {
  if (!compilation.chunkGraph) return undefined

  try {
    const files: string[] = []

    for (const chunk of compilation.chunkGraph.getModuleChunksIterable(
      module
    )) {
      for (const file of chunk.files || []) files.push(file)
    }

    return files
  } catch {
    return undefined
  }
}
