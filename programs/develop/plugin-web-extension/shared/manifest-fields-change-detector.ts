// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Unified manifest-fields change detector: replaces five ThrowIf* plugins,
// reading manifest fields once per change and diffing all categories at once.

import {Compilation, type Compiler, WebpackError} from '@rspack/core'
import {getManifestFieldsData} from 'browser-extension-manifest-fields'
import type {DevOptions, PluginInterface} from '../../types'
import {manifestHtmlEntrypointChange} from '../feature-html/html-lib/messages'
import {manifestIconsEntrypointChange} from '../feature-icons/messages'
import {serverRestartRequiredFromManifestError} from '../feature-manifest/messages'
import {AddContentScriptWrapper} from '../feature-scripts/steps/add-content-script-wrapper'

function isCriticalJsonFeatureKey(key: string): boolean {
  return (
    key.startsWith('declarative_net_request') ||
    key === 'storage.managed_schema'
  )
}

interface CategoryChange {
  hasChange: boolean
  manifestField?: string
  pathBefore?: string
  pathAfter?: string
}

type CategoryName = 'scripts' | 'html' | 'icons' | 'json'

interface Snapshot {
  scripts: string[]
  html: Record<string, string>
  icons: string[]
  json: string[]
}

function flattenValues(
  map: Record<string, string | string[]> | undefined
): string[] {
  const paths: string[] = []
  for (const val of Object.values(map || {})) {
    if (Array.isArray(val)) paths.push(...(val.filter(Boolean) as string[]))
    else if (val) paths.push(val as string)
  }
  return paths
}

function diffArray(prev: string[], next: string[]): CategoryChange | null {
  if (
    prev.length === next.length &&
    prev.every((value, i) => value === next[i])
  ) {
    return null
  }

  const maxLen = Math.max(prev.length, next.length)
  let pathBefore: string | undefined
  let pathAfter: string | undefined

  for (let i = 0; i < maxLen; i++) {
    if (prev[i] !== next[i]) {
      pathBefore = prev[i]
      pathAfter = next[i]
      break
    }
  }

  return {hasChange: true, pathBefore, pathAfter}
}

function diffRecord(
  prev: Record<string, string>,
  next: Record<string, string>
): CategoryChange | null {
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)])
  for (const key of allKeys) {
    if (prev[key] !== next[key]) {
      return {
        hasChange: true,
        manifestField: key,
        pathBefore: prev[key],
        pathAfter: next[key]
      }
    }
  }
  return null
}

export class ManifestFieldsChangeDetector {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']

  private prev: Snapshot | null = null
  private pending: Partial<Record<CategoryName, CategoryChange>> = {}

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  private readSnapshot(): Snapshot {
    const fields = getManifestFieldsData({
      manifestPath: this.manifestPath,
      browser: this.browser
    })

    const scriptsMap = (fields.scripts || {}) as Record<
      string,
      string | string[]
    >
    const scripts = flattenValues(scriptsMap)

    // Include bridge scripts for MAIN world content scripts
    const bridgeScripts = AddContentScriptWrapper.getBridgeScripts(
      this.manifestPath,
      this.browser
    )
    for (const val of Object.values(bridgeScripts)) {
      if (Array.isArray(val)) scripts.push(...(val.filter(Boolean) as string[]))
      else if (val) scripts.push(val)
    }

    const html = (fields.html || {}) as Record<string, string>

    // Icons come keyed by group with ARRAY values (one path per size); flatten
    // them, else diffArray compares inner arrays by reference and misfires.
    const iconsRaw = fields.icons as
      | Record<string, string | string[]>
      | string[]
      | undefined
    const icons = !iconsRaw
      ? []
      : Array.isArray(iconsRaw)
        ? iconsRaw
        : flattenValues(iconsRaw)

    const jsonMap = (fields.json || {}) as Record<string, string | string[]>
    const json: string[] = []
    for (const [key, val] of Object.entries(jsonMap)) {
      if (!isCriticalJsonFeatureKey(key)) continue
      if (Array.isArray(val)) json.push(...(val.filter(Boolean) as string[]))
      else if (val) json.push(val as string)
    }

    return {scripts, html, icons, json}
  }

  apply(compiler: Compiler): void {
    if (compiler.options.mode === 'production') return

    try {
      this.prev = this.readSnapshot()
    } catch {
      // Best-effort; will be set on first watchRun
    }

    compiler.hooks.watchRun.tapAsync(
      'manifest:fields-change-detector',
      (compilerArg, done) => {
        try {
          const modifiedFiles =
            (compilerArg as {modifiedFiles?: Set<string>}).modifiedFiles ||
            new Set<string>()
          if (!modifiedFiles.has(this.manifestPath)) {
            done()
            return
          }

          const next = this.readSnapshot()

          if (this.prev === null) {
            this.prev = next
            this.pending = {}
            done()
            return
          }

          const scriptsDiff = diffArray(this.prev.scripts, next.scripts)
          const htmlDiff = diffRecord(this.prev.html, next.html)
          const iconsDiff = diffArray(this.prev.icons, next.icons)
          const jsonDiff = diffArray(this.prev.json, next.json)

          this.pending = {}
          if (scriptsDiff) this.pending.scripts = scriptsDiff
          if (htmlDiff) this.pending.html = htmlDiff
          if (iconsDiff) this.pending.icons = iconsDiff
          if (jsonDiff) this.pending.json = jsonDiff

          this.prev = next
          done()
        } catch {
          done()
        }
      }
    )

    compiler.hooks.thisCompilation.tap(
      'manifest:fields-change-detector',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'manifest:fields-change-detector',
            stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_COMPATIBILITY
          },
          () => {
            this.emitErrors(compilation)
            this.pending = {}
          }
        )
      }
    )
  }

  private emitErrors(compilation: Compilation): void {
    if (this.pending.scripts) {
      const p = this.pending.scripts
      const msg = serverRestartRequiredFromManifestError(
        p.pathAfter || '',
        p.pathBefore || ''
      )
      const err = new WebpackError(msg) as Error & {file?: string}
      err.file = 'manifest.json'
      compilation.errors.push(err)
    }

    if (this.pending.html) {
      const p = this.pending.html
      const msg = manifestHtmlEntrypointChange(
        p.manifestField,
        p.pathAfter,
        p.pathBefore
      )
      const err = new WebpackError(msg) as Error & {file?: string}
      err.file = 'manifest.json'
      compilation.errors.push(err)
    }

    if (this.pending.icons) {
      const p = this.pending.icons
      const msg = manifestIconsEntrypointChange(
        p.manifestField,
        p.pathAfter,
        p.pathBefore
      )
      const err = new WebpackError(msg) as Error & {file?: string}
      err.file = 'manifest.json'
      compilation.errors.push(err)
    }

    if (this.pending.json) {
      const p = this.pending.json
      const field = p.manifestField || 'json'
      const lines: string[] = []
      lines.push(
        `Entrypoint references changed in ${field}. Restart the dev server to pick up changes to critical manifest JSON files.`
      )
      lines.push('')
      if (p.pathBefore) lines.push(`PATH BEFORE ${p.pathBefore}`)
      if (p.pathAfter) lines.push(`PATH AFTER ${p.pathAfter}`)
      const err = new WebpackError(lines.join('\n')) as Error & {file?: string}
      err.file = 'manifest.json'
      compilation.errors.push(err)
    }
  }
}
