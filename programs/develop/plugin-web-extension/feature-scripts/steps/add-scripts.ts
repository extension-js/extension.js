// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler, EntryObject} from '@rspack/core'
import {stripBom} from '../../../lib/parse-json-safe'
import type {DevOptions, FilepathList, PluginInterface} from '../../../types'
import {classicConcatEntry, isClassicScript} from '../../shared/classic-concat'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../contracts'
import {getCssEntries, getScriptEntries} from '../scripts-lib/utils'
import {AddContentScriptWrapper} from './add-content-script-wrapper'

const isRemoteUrl = (entry: string) => /^([a-z][a-z0-9+.-]*:)?\/\//i.test(entry)
const isContentScriptFeature = (feature: string) =>
  feature.startsWith('content_scripts/')
const isScriptsFolderFeature = (feature: string) =>
  feature.startsWith('scripts/')
const isBackgroundScriptsFeature = (feature: string) =>
  feature === 'background/scripts'

function createSequentialEntryModule(
  feature: string,
  scriptImports: string[]
): string {
  // Only the JS files are sequenced/concatenated here. CSS is declared by the
  // caller as a bare entry import (see `finalEntryImports` below) so it extracts
  // to the canonical `content_scripts/content-N.css` name, routing CSS through
  // this entry module instead would root its import at a content-script module,
  // which flips it to `asset/inline` and never emits the file the manifest
  // declares.
  const jsFiles = scriptImports

  // Classic content scripts split across multiple files share a single global
  // scope: the browser injects `content_scripts[].js` in order into one world, so
  // a top-level `class Base` in one file is visible to a sibling that extends it.
  // ES-module sequencing (import "a"; import "b";) isolates each file and breaks
  // those implicit cross-file globals. When every JS file in the group is classic
  // (no top-level import/export), concatenate their sources into one module so they
  // share a scope, matching browser semantics and making vanilla multi-file content
  // scripts a true drop-in. CSS stays as module imports so rspack can extract it.
  // Only .js/.cjs/.ts can concatenate: .mjs is module-scoped by definition,
  // and .tsx/.jsx need a JSX transform the concat loader doesn't run. The
  // loader type-strips .ts members before concatenation, so a tsc-compiled
  // extension re-pointed at its TS sources keeps its shared-globals contract.
  const concatEligible = (f: string) => /\.(js|cjs|ts)$/i.test(f)
  const concatenateClassic =
    jsFiles.length > 1 &&
    jsFiles.every((f) => concatEligible(f) && isClassicScript(f))

  if (concatenateClassic) {
    return classicConcatEntry(feature, jsFiles)
  }

  const source = [
    `/* extension.js sequential entry: ${feature} */`,
    ...jsFiles.map(
      (entryImport) => `import ${JSON.stringify(String(entryImport))};`
    )
  ].join('\n')

  return `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`
}

export class AddScripts {
  public readonly manifestPath: string
  public readonly includeList: FilepathList
  public readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList || {}
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler): void {
    const bridgeScripts = AddContentScriptWrapper.getBridgeScripts(
      this.manifestPath,
      this.browser
    )
    const scriptFields: FilepathList = {
      ...this.includeList,
      ...bridgeScripts
    }

    if (compiler?.hooks?.thisCompilation?.tap) {
      compiler.hooks.thisCompilation.tap(
        'scripts:validate-include-list',
        (compilation) => {
          try {
            const manifestDir = path.dirname(this.manifestPath)
            const outputRoot = compilation.options?.output?.path || ''
            const ErrorCtor = compiler.rspack?.WebpackError || Error

            for (const [feature, raw] of Object.entries(scriptFields)) {
              const rawEntries: string[] = Array.isArray(raw)
                ? (raw as string[]).filter(Boolean)
                : raw
                  ? [raw as string]
                  : []

              for (const entry of rawEntries) {
                if (!entry || typeof entry !== 'string' || isRemoteUrl(entry)) {
                  continue
                }

                let resolved = entry
                if (!fs.existsSync(resolved)) {
                  resolved = path.isAbsolute(entry)
                    ? entry
                    : entry.startsWith('/')
                      ? path.join(manifestDir, entry.slice(1))
                      : path.join(manifestDir, entry)
                }

                if (fs.existsSync(resolved)) continue

                const isPublicRoot =
                  entry.startsWith('/') && !path.isAbsolute(entry)
                const displayPath = isPublicRoot
                  ? outputRoot
                    ? path.join(outputRoot, entry.slice(1))
                    : entry
                  : resolved

                const err = new ErrorCtor(
                  [
                    `Check the ${feature.replace('/', '.')} field in your manifest.json file.`,
                    `The script path must point to an existing file that will be bundled.`,
                    isPublicRoot
                      ? `Paths starting with '/' are resolved from the extension output root (served from public/), not your source directory.`
                      : '',
                    '',
                    `NOT FOUND ${displayPath}`
                  ]
                    .filter(Boolean)
                    .join('\n')
                ) as Error & {file?: string; name?: string}
                err.file = 'manifest.json'
                err.name = 'ScriptsMissingFile'
                ;(compilation.errors ||= []).push(err)
              }
            }
          } catch {
            // ignore guard errors
          }
        }
      )
    }

    const newEntries: Record<string, EntryObject> = {}
    const manifestDir = path.dirname(this.manifestPath)
    const projectPath = (compiler.options.context as string) || manifestDir
    let manifestJson: any = {}
    try {
      manifestJson = JSON.parse(
        stripBom(fs.readFileSync(this.manifestPath, 'utf8'))
      )
    } catch {
      manifestJson = {}
    }
    const resolveEntryPath = (entry: string) => {
      if (!entry || isRemoteUrl(entry)) return entry
      if (entry.startsWith('/') && !path.isAbsolute(entry)) {
        return path.join(projectPath, entry.slice(1))
      }
      if (path.isAbsolute(entry)) return entry
      return path.join(manifestDir, entry)
    }

    // Files under the `scripts/` special folder are registered as standalone
    // entries so bare `scripts/` helpers still get compiled. But when a file is
    // ALSO declared in a manifest `content_scripts` group it is already built by
    // that (concatenated) entry, registering a second, standalone entry both
    // duplicates output and, worse, parses the file in isolation as a
    // CommonJS-capable module. Vendored UMD libs then trip rspack on their dead
    // `typeof module === 'object' && require('pkg')` branch (e.g. katex), failing
    // the build. Collect the content-script-claimed paths so those `scripts/`
    // duplicates can be skipped below.
    //
    // Only content_scripts claims count: a content_scripts group is rewritten in
    // the emitted manifest to `content_scripts/content-N.js`, so the original
    // `scripts/foo.js` path is no longer referenced and its standalone output is
    // pure duplication. Background is deliberately excluded. A manifest can keep
    // an MV2 `background.scripts: ["scripts/x.js"]` entry pointing at the raw
    // `scripts/` path (which the concat emits under a *different* name,
    // `background/scripts.js`), so its standalone `scripts/x.js` output is still
    // required on disk.
    const claimedByContentScript = new Set<string>()
    for (const [feature, scriptPath] of Object.entries(scriptFields)) {
      if (!isContentScriptFeature(feature)) continue
      const rawEntries: string[] = Array.isArray(scriptPath)
        ? scriptPath || []
        : scriptPath
          ? [scriptPath]
          : []
      for (const resolved of getScriptEntries(
        rawEntries.map(resolveEntryPath)
      )) {
        claimedByContentScript.add(path.resolve(resolved))
      }
    }

    for (const [feature, scriptPath] of Object.entries(scriptFields)) {
      const rawEntries: string[] = Array.isArray(scriptPath)
        ? scriptPath || []
        : scriptPath
          ? [scriptPath]
          : []
      const resolvedEntries = rawEntries.map(resolveEntryPath)
      const scriptImports = isScriptsFolderFeature(feature)
        ? getScriptEntries(resolvedEntries).filter(
            (p) => !claimedByContentScript.has(path.resolve(p))
          )
        : getScriptEntries(resolvedEntries)
      const cssImports = getCssEntries(resolvedEntries)
      const entryImports = [...new Set([...scriptImports, ...cssImports])]
      const shouldUseSequentialEntryModule =
        (isContentScriptFeature(feature) ||
          isBackgroundScriptsFeature(feature)) &&
        scriptImports.length > 1
      const finalEntryImports = shouldUseSequentialEntryModule
        ? [createSequentialEntryModule(feature, scriptImports), ...cssImports]
        : entryImports

      if (!finalEntryImports.length) continue

      newEntries[feature] =
        feature === 'background/service_worker'
          ? {
              import: finalEntryImports,
              ...(manifestJson.background?.type === 'module'
                ? {}
                : {chunkLoading: 'import-scripts'})
            }
          : {
              import: finalEntryImports,
              ...(isContentScriptFeature(feature) ||
              isScriptsFolderFeature(feature)
                ? {layer: EXTENSIONJS_CONTENT_SCRIPT_LAYER}
                : {})
            }
    }

    compiler.options.entry = {
      ...compiler.options.entry,
      ...newEntries
    }
  }
}
