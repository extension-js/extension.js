// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Root-absolute reference fallback (Chrome resolves a leading '/' from the
// EXTENSION ROOT): runs over EMITTED assets, additive, public/ still wins.

import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compilation, rspack, WebpackError} from '@rspack/core'
import * as messages from '../plugin-web-extension/feature-scripts/messages'
import {
  type CompileRequest,
  compileRuntimeLoadedFiles,
  planTracedFile,
  type TracedFilePlan
} from '../plugin-web-extension/feature-scripts/steps/trace-runtime-loaded-files'
import {collectRootAbsoluteRefs} from '../plugin-web-extension/shared/paths'

// The asset a ref was read from, which names the surface in a warning.
interface RefOrigin {
  asset: string
  kind: 'html' | 'css'
}

// Decide how a root-absolute ref ships, with the tracer's rule: data files
// and classic hand-written .js copy verbatim, anything the browser cannot run
// as written compiles through the bundler at the path the ref asks for.
// Null means the value is not a ref at all.
export function planRootAbsoluteRef(
  ref: string,
  context: string,
  publicDir: string,
  hasAsset: (name: string) => boolean
): TracedFilePlan | null {
  if (!ref || !ref.startsWith('/')) return null
  // A protocol-relative URL is an address, not a file.
  if (ref.startsWith('//')) return null
  // On POSIX a real filesystem path is also "/"-prefixed, so it is not a ref.
  if (context && ref.startsWith(context)) return null

  const outputName = ref.replace(/^\/+/, '')
  if (!outputName) return null

  // public/ keeps precedence. It is the documented output-root contract.
  if (isFile(path.join(publicDir, outputName))) {
    return {kind: 'skip', reason: 'public', emitPath: outputName}
  }

  // Root refs are root-anchored, so source and dist paths match.
  return planTracedFile({
    manifestDir: context,
    sourceRel: outputName,
    distRel: outputName,
    loadsAs: 'by-shape',
    hasAsset
  })
}

export async function emitRootAbsoluteRefs(
  compilation: Compilation,
  context: string,
  publicDir: string
): Promise<void> {
  const scanned = new Set<string>()
  const warned = new Set<string>()
  const hasAsset = (name: string) => Boolean(compilation.getAsset(name))

  // Fixed point: a copied CSS file can itself carry root refs; keep scanning
  // newly emitted assets until nothing new turns up.
  for (let pass = 0; pass < 10; pass++) {
    const refs = new Map<string, RefOrigin>()

    for (const asset of compilation.getAssets()) {
      if (!/\.(html|css)$/i.test(asset.name)) continue
      if (scanned.has(asset.name)) continue
      scanned.add(asset.name)

      let source: string
      try {
        source = String(asset.source.source())
      } catch {
        continue
      }
      const kind = /\.css$/i.test(asset.name) ? 'css' : 'html'
      for (const ref of collectRootAbsoluteRefs(source)) {
        if (!refs.has(ref)) refs.set(ref, {asset: asset.name, kind})
      }
    }

    if (refs.size === 0) return

    // The bundler resolves a compiled file's imports itself, so there is no
    // import walk here: only what HTML and CSS name is planned.
    const requests = new Map<string, CompileRequest>()
    let emitted = 0
    for (const [ref, origin] of refs) {
      const plan = planRootAbsoluteRef(ref, context, publicDir, hasAsset)
      if (!plan) continue

      // The ref spells a source the build compiles to .js, so the browser
      // would ask for a path the output does not contain.
      const spelledAs = 'spelledAs' in plan ? plan.spelledAs : undefined
      if (spelledAs && !warned.has(ref)) {
        warned.add(ref)
        warn(
          compilation,
          origin.asset,
          messages.compiledSourceSpelling(
            origin.asset,
            origin.kind === 'css'
              ? 'a CSS url()'
              : 'an HTML src/href attribute',
            ref,
            plan.emitPath
          )
        )
      }

      switch (plan.kind) {
        case 'copy': {
          try {
            const buffer = fs.readFileSync(plan.sourcePath)
            compilation.emitAsset(
              plan.emitPath,
              new rspack.sources.RawSource(buffer)
            )
            // Keep watch mode honest: editing the file should rebuild.
            watch(compilation, plan.sourcePath)
            emitted++
          } catch {
            // A file we cannot read is not worth failing the whole build over,
            // the existing missing-file reporting still surfaces the broken ref.
          }
          break
        }
        case 'compile': {
          // First request for an output path wins, so one file reached through
          // two spellings compiles once.
          if (!requests.has(plan.emitPath)) {
            requests.set(plan.emitPath, {
              sourcePath: plan.sourcePath,
              emitPath: plan.emitPath,
              format: plan.format,
              context: 'html'
            })
          }
          watch(compilation, plan.sourcePath)
          break
        }
        default:
          // Skipped refs are owned by public/ or by the main compilation, and
          // a missing ref is reported by the existing missing-file checks.
          break
      }
    }

    if (requests.size > 0) {
      const compiled = await compileRuntimeLoadedFiles(
        compilation,
        compilation.compiler,
        [...requests.values()]
      )
      emitted += compiled.length
    }

    if (emitted === 0) return
  }
}

function warn(compilation: Compilation, file: string, message: string) {
  const warning = new WebpackError(message) as Error & {
    file?: string
    name?: string
  }
  warning.name = 'RootAbsoluteRefCompiledSource'
  warning.file = file
  compilation.warnings ||= []
  compilation.warnings.push(warning)
}

function watch(compilation: Compilation, abs: string) {
  try {
    compilation.fileDependencies.add(abs)
  } catch {
    // Ignore, watch registration is best-effort
  }
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}
