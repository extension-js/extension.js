// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {isGeckoBasedBrowser} from '../../../lib/constants'
import {filterKeysForThisBrowser} from '../../../lib/manifest-utils'
import {parseAuthoredJson} from '../../../lib/parse-json-safe'
import type {DevOptions, FilepathList, PluginInterface} from '../../../types'
import {classicConcatEntry, isClassicScript} from '../../shared/classic-concat'
import {
  isRemoteUrl,
  resolveScriptEntryPath
} from '../../shared/script-entry-path'
import {
  EXTENSIONJS_CONTENT_SCRIPT_LAYER,
  parseCanonicalContentScriptEntryIndex
} from '../contracts'
import * as messages from '../messages'
import {
  getCssEntries,
  getScriptEntries,
  withheldEntryKind
} from '../scripts-lib/utils'
import {AddContentScriptWrapper} from './add-content-script-wrapper'

const isContentScriptFeature = (feature: string) =>
  feature.startsWith('content_scripts/')
const isScriptsFolderFeature = (feature: string) =>
  feature.startsWith('scripts/')
const isBackgroundScriptsFeature = (feature: string) =>
  feature === 'background/scripts'

// The development manifest names a script for a group that lists only
// stylesheets, and the bundler emits none for an entry made of sheets alone.
const SHEET_ONLY_GROUP_SCRIPT = `data:text/javascript;charset=utf-8,${encodeURIComponent(
  '/* Extension.js stylesheet group */'
)}`

// The field as the manifest writes it: a content script group lists its
// scripts and its stylesheets apart, under the index of the group.
export function manifestFieldOf(
  feature: string,
  entry: string,
  sheets: ReadonlyMap<number, ReadonlySet<string>>
): string {
  // The theme entry is named after its file, and the field has one name.
  if (feature.startsWith('theme_experiment/')) {
    return 'theme_experiment.stylesheet'
  }

  const group = parseCanonicalContentScriptEntryIndex(feature)

  if (group === undefined) return feature.replace('/', '.')

  // The list that named the file says which, since a name may lack an ending.
  const list = sheets.get(group)?.has(path.resolve(entry)) ? 'css' : 'js'

  return `content_scripts[${group}].${list}`
}

// The stylesheets of each content script group, by the path each is read
// from, so a reported file names the list it came from.
function contentScriptSheets(
  manifest: {content_scripts?: unknown},
  manifestDir: string,
  projectPath: string
): Map<number, Set<string>> {
  const sheets = new Map<number, Set<string>>()
  const groups = Array.isArray(manifest.content_scripts)
    ? manifest.content_scripts
    : []

  groups.forEach((group, index) => {
    const css = (group as {css?: unknown} | null)?.css
    const named = new Set<string>()

    for (const sheet of Array.isArray(css) ? css : []) {
      if (typeof sheet !== 'string' || !sheet) continue

      // As written, and as the manifest fields list reads it from the folder.
      for (const spelling of [
        sheet,
        path.join(manifestDir, sheet.replace(/^[\\/]+/, ''))
      ]) {
        named.add(
          path.resolve(
            resolveScriptEntryPath(spelling, manifestDir, projectPath)
          )
        )
      }
    }

    sheets.set(index, named)
  })

  return sheets
}

// The bundler's own report for an entry request that names one of the
// files, whatever way the platform spells the path in it.
function isUnresolvedEntryReport(message: string, files: string[]): boolean {
  const spelled = (text: string) => text.replace(/\\+/g, '/').toLowerCase()
  const text = spelled(message)

  return files.some((file) => text.includes(`can't resolve '${spelled(file)}'`))
}

export function createSequentialEntryModule(
  feature: string,
  scriptImports: string[]
): string {
  // Only JS is sequenced/concatenated here. CSS stays a bare entry import;
  // routed through this module it flips to asset/inline and never emits.
  const jsFiles = scriptImports

  // Classic content scripts share one global scope in the browser; ES-module
  // sequencing breaks that, so all-classic groups concatenate into one module.
  const concatEligible = (f: string) => /\.(js|cjs|ts)$/i.test(f)
  const concatenateClassic =
    jsFiles.length > 1 &&
    jsFiles.every((f) => concatEligible(f) && isClassicScript(f))

  if (concatenateClassic) {
    return classicConcatEntry(feature, jsFiles)
  }

  const source = [
    `/* Extension.js sequential entry: ${feature} */`,
    ...jsFiles.map(
      (entryImport) => `import ${JSON.stringify(String(entryImport))};`
    )
  ].join('\n')

  return `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`
}

export class AddScripts {
  public readonly manifestPath: string
  public readonly includeList: FilepathList
  // The files a field names and the build withholds, which are no entry.
  public readonly withheldList: FilepathList
  public readonly browser: DevOptions['browser']

  constructor(options: PluginInterface & {withheldList?: FilepathList}) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList || {}
    this.withheldList = options.withheldList || {}
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

    compiler.hooks.thisCompilation.tap(
      'scripts:validate-include-list',
      (compilation) => {
        const ErrorCtor = compiler.rspack?.WebpackError || Error
        const missing: string[] = []

        try {
          const manifestDir = path.dirname(this.manifestPath)
          const projectPath =
            (compiler.options.context as string) || manifestDir
          const listOf = (raw: FilepathList[string]): string[] =>
            Array.isArray(raw)
              ? (raw as string[]).filter(Boolean)
              : raw
                ? [raw as string]
                : []
          // Read below, before any compilation starts.
          const sheets = contentScriptSheets(
            manifestJson,
            manifestDir,
            projectPath
          )
          // A withheld file is reported apart from a missing one.
          const named = [
            ...Object.entries(scriptFields).map(
              ([feature, raw]) => [feature, listOf(raw), false] as const
            ),
            ...Object.entries(this.withheldList).map(
              ([feature, raw]) => [feature, listOf(raw), true] as const
            )
          ]

          for (const [feature, rawEntries, isWithheld] of named) {
            for (const entry of rawEntries) {
              if (!entry || typeof entry !== 'string' || isRemoteUrl(entry)) {
                continue
              }

              // The path the entry itself is built from, and no other.
              const resolved = resolveScriptEntryPath(
                entry,
                manifestDir,
                projectPath
              )

              if (!isWithheld && fs.existsSync(resolved)) continue

              if (!isWithheld) missing.push(resolved)

              const file = path
                .relative(manifestDir, resolved)
                .split(path.sep)
                .join('/')
              const field = manifestFieldOf(feature, resolved, sheets)
              const err = new ErrorCtor(
                isWithheld
                  ? messages.scriptsWithheldFile(
                      file,
                      field,
                      withheldEntryKind(resolved, [projectPath, manifestDir]),
                      resolved
                    )
                  : messages.scriptsMissingFile(file, field, resolved)
              ) as Error & {file?: string; name?: string}
              err.file = 'manifest.json'
              err.name = 'ScriptsMissingFile'
              compilation.errors.push(err)
            }
          }
        } catch (error) {
          // A check that stops half way reports nothing for the files it
          // never reached, so the build says so instead of passing quietly.
          const failure = new ErrorCtor(
            messages.scriptPathsCheckFailed(
              String((error as Error)?.message || error)
            )
          ) as Error & {file?: string; cause?: unknown}
          failure.file = 'manifest.json'
          failure.name = 'ScriptsPathCheckFailed'
          failure.cause = error
          compilation.errors.push(failure)
        }

        if (missing.length === 0) return

        // One report per missing file, and this step's names the field.
        compilation.hooks.seal.tap(
          'scripts:one-report-per-missing-file',
          () => {
            const reports = Array.from(compilation.errors)
            const kept = reports.filter(
              (report) =>
                !isUnresolvedEntryReport(String(report?.message), missing)
            )

            if (kept.length !== reports.length) compilation.errors = kept
          }
        )
      }
    )

    const newEntries: Record<
      string,
      Exclude<
        Compiler['options']['entry'],
        (...args: never[]) => unknown
      >[string]
    > = {}
    const manifestDir = path.dirname(this.manifestPath)
    const projectPath = (compiler.options.context as string) || manifestDir
    let manifestJson: {
      manifest_version?: unknown
      background?: {type?: unknown}
      content_scripts?: unknown
    } = {}

    try {
      // A chromium:background module worker is invisible to a raw read, so the
      // entry got importScripts chunk loading while the worker itself is ESM.
      manifestJson = filterKeysForThisBrowser(
        parseAuthoredJson(fs.readFileSync(this.manifestPath, 'utf8')),
        this.browser
      ) as typeof manifestJson
    } catch {
      manifestJson = {}
    }

    const resolveEntryPath = (entry: string) =>
      resolveScriptEntryPath(entry, manifestDir, projectPath)

    // A scripts/ file the manifest also names under a field of its own is
    // already built by that field's entry, at the path the emitted manifest
    // points at. Entering it again under scripts/ ships the same bundle twice
    // and, on vendored UMD libs, trips rspack. Every declared field claims the
    // same way: a service worker is no different from a content script group.
    const claimedByManifestField = new Set<string>()

    for (const [feature, scriptPath] of Object.entries(scriptFields)) {
      if (isScriptsFolderFeature(feature)) continue

      const rawEntries: string[] = Array.isArray(scriptPath)
        ? scriptPath || []
        : scriptPath
          ? [scriptPath]
          : []

      for (const resolved of getScriptEntries(
        rawEntries.map(resolveEntryPath)
      )) {
        claimedByManifestField.add(path.resolve(resolved))
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
            (p) => !claimedByManifestField.has(path.resolve(p))
          )
        : getScriptEntries(resolvedEntries)
      const cssImports = getCssEntries(resolvedEntries)
      const entryImports = [...new Set([...scriptImports, ...cssImports])]
      const shouldUseSequentialEntryModule =
        (isContentScriptFeature(feature) ||
          isBackgroundScriptsFeature(feature)) &&
        scriptImports.length > 1
      // Build-mode naming, not reload: a development compile loads the
      // styles of a CSS-only group through a script, session or not.
      const needsDevelopmentScript =
        compiler.options.mode === 'development' &&
        isContentScriptFeature(feature) &&
        scriptImports.length === 0 &&
        cssImports.length > 0
      const finalEntryImports = shouldUseSequentialEntryModule
        ? [createSequentialEntryModule(feature, scriptImports), ...cssImports]
        : needsDevelopmentScript
          ? [SHEET_ONLY_GROUP_SCRIPT, ...cssImports]
          : entryImports

      if (!finalEntryImports.length) continue

      // On Chromium an MV3 background.scripts bundle is repointed to
      // service_worker (patch-chromium-background), so it boots as a worker
      // with no `document`: it needs the same worker chunk loader as a
      // declared service_worker or a split chunk kills the background.
      const runsAsWorker =
        feature === 'background/service_worker' ||
        (isBackgroundScriptsFeature(feature) &&
          Number(manifestJson.manifest_version) === 3 &&
          !isGeckoBasedBrowser(String(this.browser)))

      // A module worker cannot importScripts, and a service worker cannot
      // import() either, so it gets no chunk loader at all: the default
      // jsonp loader would read document.baseURI and kill it on start.
      const workerChunkLoading: false | 'import-scripts' =
        manifestJson.background?.type === 'module' ? false : 'import-scripts'

      newEntries[feature] = runsAsWorker
        ? {
            import: finalEntryImports,
            chunkLoading: workerChunkLoading,
            // A Chromium service worker can fetch a script only while it
            // installs, so what import() names ships inside the worker file.
            asyncChunks: false
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
