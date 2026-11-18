// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

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
import * as htmlMessages from '../plugin-web-extension/feature-html/html-lib/messages'
import {collectRootAbsoluteRefs} from '../plugin-web-extension/shared/paths'
import * as cssMessages from '../plugin-css/css-lib/messages'
import * as folderMessages from './messages'
import {hasPrivateFileName, sourceFileMayShip} from './public-private-files'
import {isOsPathUnder} from '../lib/real-path'

// The asset a ref was read from, which names the surface in a warning.
interface RefOrigin {
  asset: string
  kind: 'html' | 'css'
}

// A ref the build will not answer from the source folder: a private name, or
// a file that sits or resolves outside the project. It is reported as missing.
interface WithheldRef {
  kind: 'withheld'
  emitPath: string
}

export type RootAbsoluteRefPlan = TracedFilePlan | WithheldRef

// The name as written and as the browser reads it, where `%2e%2e` is `..`.
function browserSpellings(outputName: string): string[] {
  const spellings = [outputName]

  try {
    spellings.push(decodeURIComponent(outputName))
  } catch {
    // Not a valid escape, so the browser asks for the name as written.
  }

  return spellings.map((spelling) =>
    path.posix.normalize(spelling.replace(/\\/g, '/'))
  )
}

function climbsOut(normalized: string): boolean {
  return normalized === '..' || normalized.startsWith('../')
}

// Decide how a root-absolute ref ships, with the tracer's rule: data files
// and classic hand-written .js copy verbatim, anything the browser cannot run
// as written compiles through the bundler at the path the ref asks for.
// Null means the value is not a ref at all.
export function planRootAbsoluteRef(
  ref: string,
  context: string,
  publicDir: string,
  hasAsset: (name: string) => boolean,
  // The manifest can sit below the project root, in src/ for one.
  projectRoot: string = context
): RootAbsoluteRefPlan | null {
  if (!ref || !ref.startsWith('/')) return null
  // A protocol-relative URL is an address, not a file.
  if (ref.startsWith('//')) return null
  // On POSIX a real filesystem path is also "/"-prefixed, so it is not a ref.
  if (context && isOsPathUnder(context, ref)) return null

  const outputName = ref.replace(/^\/+/, '')
  if (!outputName) return null

  // The compilation already holds it, under the name as written or the one
  // the browser asks for, so another step owns that file.
  if (hasAsset(outputName) || hasAsset(path.posix.normalize(outputName))) {
    return {kind: 'skip', reason: 'emitted', emitPath: outputName}
  }

  // Asked before public/: the copier leaves these names out as well, so the
  // folder cannot answer for one.
  const spellings = browserSpellings(outputName)

  if (spellings.some((name) => climbsOut(name) || hasPrivateFileName(name))) {
    return {kind: 'withheld', emitPath: outputName}
  }

  // public/ keeps precedence. It is the documented output-root contract.
  if (isFile(path.join(publicDir, outputName))) {
    return {kind: 'skip', reason: 'public', emitPath: outputName}
  }

  // Root refs are root-anchored, so source and dist paths match.
  const plan = planTracedFile({
    manifestDir: context,
    sourceRel: outputName,
    distRel: outputName,
    loadsAs: 'by-shape',
    hasAsset
  })

  if (
    (plan.kind === 'copy' || plan.kind === 'compile') &&
    !sourceFileMayShip(plan.sourcePath, [projectRoot, context])
  ) {
    return {kind: 'withheld', emitPath: outputName}
  }

  return plan
}

export async function emitRootAbsoluteRefs(
  compilation: Compilation,
  context: string,
  publicDir: string,
  // `folders: {public: false}`: a ref public/ satisfies has no copier.
  publicIsOff = false,
  projectRoot: string = context
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
      const plan = planRootAbsoluteRef(
        ref,
        context,
        publicDir,
        hasAsset,
        projectRoot
      )
      if (!plan) continue

      if (plan.kind === 'withheld') {
        if (!warned.has(ref)) {
          warned.add(ref)
          reportWithheld(compilation, context, origin, ref, plan.emitPath)
        }

        continue
      }

      // The ref spells a source the build compiles to .js, so the browser
      // would ask for a path the output does not contain.
      const spelledAs = 'spelledAs' in plan ? plan.spelledAs : undefined

      // A page names the source, so point it at the file the build emits.
      if (spelledAs && origin.kind === 'html') {
        rewriteHtmlRef(compilation, origin.asset, ref, `/${plan.emitPath}`)
      } else if (spelledAs && !warned.has(ref)) {
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

      if (
        publicIsOff &&
        plan.kind === 'skip' &&
        plan.reason === 'public' &&
        !hasAsset(plan.emitPath) &&
        !warned.has(ref)
      ) {
        warned.add(ref)
        warn(
          compilation,
          origin.asset,
          folderMessages.publicFolderOffRef(
            origin.asset,
            origin.kind === 'css'
              ? 'a CSS url()'
              : 'an HTML src/href attribute',
            ref
          ),
          'PublicFolderOffRef'
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

const ESC = String.fromCharCode(27)
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')

// The finding a missing file gets for that kind of ref, in its own words.
// The page step says it first for some refs, so it is not said twice.
function reportWithheld(
  compilation: Compilation,
  context: string,
  origin: RefOrigin,
  ref: string,
  emitPath: string
) {
  if (origin.kind === 'css') {
    const strict = process.env.EXTENSION_STRICT_REFS === 'true'
    const report = diagnostic(
      cssMessages.deadCssUrlRef(origin.asset, ref),
      origin.asset,
      'CssDeadRef'
    )

    if (strict) {
      compilation.errors ||= []
      compilation.errors.push(report)
    } else {
      compilation.warnings ||= []
      compilation.warnings.push(report)
    }

    return
  }

  // Spread first: the bundler's list answers `some` without visiting a thing.
  const alreadySaid = [...(compilation.warnings || [])].some((warning) =>
    String(warning?.message || '')
      .replace(ANSI, '')
      .includes(`Update the ${ref} reference`)
  )
  if (alreadySaid) return

  warn(
    compilation,
    origin.asset,
    // A climbing path is shown where the browser would look, at the root.
    htmlMessages.fileNotFound(
      origin.asset,
      path.join(context, path.posix.normalize(`/${emitPath}`)),
      {publicRootHint: true, refLabel: ref}
    ),
    'RootAbsoluteRefMissing'
  )
}

function rewriteHtmlRef(
  compilation: Compilation,
  assetName: string,
  ref: string,
  replacement: string
) {
  const asset = compilation.getAsset(assetName)
  if (!asset) return

  const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const quoted = new RegExp(`=(\\s*)(["'])${escaped}\\2`, 'g')
  const bare = new RegExp(`=(\\s*)${escaped}(?=[\\s>])`, 'g')
  const html = String(asset.source.source())
  const updated = html
    .replace(
      quoted,
      (_match, space: string, quote: string) =>
        `=${space}${quote}${replacement}${quote}`
    )
    .replace(bare, (_match, space: string) => `=${space}${replacement}`)

  if (updated !== html) {
    compilation.updateAsset(assetName, new rspack.sources.RawSource(updated))
  }
}

function warn(
  compilation: Compilation,
  file: string,
  message: string,
  name = 'RootAbsoluteRefCompiledSource'
) {
  compilation.warnings ||= []
  compilation.warnings.push(diagnostic(message, file, name))
}

function diagnostic(message: string, file: string, name: string) {
  const report = new WebpackError(message) as Error & {file?: string}
  report.name = name
  report.file = file

  return report
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
