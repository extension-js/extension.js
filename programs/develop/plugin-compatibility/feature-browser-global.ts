//  ██████╗ ██████╗ ███╗   ███╗██████╗  █████╗ ████████╗██╗██████╗ ██╗██╗     ██╗████████╗██╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██╔══██╗╚══██╔══╝██║██╔══██╗██║██║     ██║╚══██╔══╝╚██╗ ██╔╝
// ██║     ██║   ██║██╔████╔██║██████╔╝███████║   ██║   ██║██████╔╝██║██║     ██║   ██║    ╚████╔╝
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██╔══██║   ██║   ██║██╔══██╗██║██║     ██║   ██║     ╚██╔╝
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║  ██║   ██║   ██║██████╔╝██║███████╗██║   ██║      ██║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝╚═════╝ ╚═╝╚══════╝╚═╝   ╚═╝      ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import {Compilation, type Compiler} from '@rspack/core'
import {
  type EmittedCompilation,
  type EmittedModule,
  emittedFilesOf,
  readEmittedScripts,
  readProjectSource
} from '../lib/emitted-evidence'
import {
  mentionsBrowserName,
  referencesBrowserGlobal
} from '../lib/free-browser-references'
import {getManifestContent} from '../plugin-web-extension/feature-manifest/manifest-lib/manifest'
import {scannableSourcePath} from '../plugin-web-extension/feature-manifest/steps/apply-dev-defaults-lib/dev-injected-hosts'
import {isHotUpdateFile} from '../plugin-web-extension/shared/initial-files'
import type {DevOptions, PluginInterface} from '../types'
import * as messages from './compatibility-lib/messages'
import {
  NATIVE_BROWSER_NAMESPACE_CHROMIUM_DEVTOOLS,
  nativeBrowserNamespaceFloor
} from './compatibility-lib/native-browser-namespace'

type BrowserGlobalWarningCommand = NonNullable<
  messages.BrowserGlobalWarningContext['command']
>

interface ScanCompilation extends EmittedCompilation {
  modules: Iterable<EmittedModule>
}

function offendingScripts(compilation: ScanCompilation): string[] {
  const offenders: string[] = []

  for (const [name, text] of readEmittedScripts(compilation)) {
    if (isHotUpdateFile(name)) continue
    if (referencesBrowserGlobal(text)) offenders.push(name)
  }

  return offenders
}

const READS_BROWSER_RE = /(?<![\w$.'"`])browser\s*[.[]/
const GUARDED_READ_RE = /typeof\s+browser\b|['"]browser['"]\s+in\b/

// The first line of a source that reads browser.* outside a typeof or `in`
// guard, so the warning names a line the author can open. A file whose only
// mentions are guarded still names its first mention, with no line.
export function browserReadLine(text: string): number | undefined {
  const lines = text.split(/\r?\n/)
  const at = lines.findIndex(
    (line) => READS_BROWSER_RE.test(line) && !GUARDED_READ_RE.test(line)
  )

  return at >= 0 ? at + 1 : undefined
}

// The project files bundled into an offending script that spell the name
// out, so the warning points at source the author wrote, not at dist.
export function sourcesBehind(
  compilation: ScanCompilation,
  scripts: string[],
  manifestDir: string
): string[] {
  const sources = new Set<string>()

  for (const outer of compilation.modules) {
    const files = emittedFilesOf(compilation, outer)
    if (!files?.some((file) => scripts.includes(file))) continue

    const inner = outer.modules ? [...outer.modules] : [outer]

    for (const module of inner) {
      const resource = scannableSourcePath(module.resource)
      if (!resource) continue

      const text = readProjectSource(resource, compilation)
      if (text === undefined || !mentionsBrowserName(text)) continue

      const relative = path
        .relative(manifestDir, resource)
        .split(path.sep)
        .join('/')
      const line = browserReadLine(text)

      sources.add(line ? `${relative}:${String(line)}` : relative)
    }
  }

  return [...sources].sort()
}

// The build's manifest refuses every Chromium too old to have the namespace,
// so no browser that can install this extension lacks `browser`.
export function declaresNativeBrowserNamespace(manifest: {
  minimum_chrome_version?: unknown
  devtools_page?: unknown
}): boolean {
  const major = Number.parseInt(String(manifest.minimum_chrome_version), 10)

  return major >= nativeBrowserNamespaceFloor(manifest)
}

function declaredMinimumOf(manifest: {
  minimum_chrome_version?: unknown
}): number | undefined {
  const major = Number.parseInt(String(manifest.minimum_chrome_version), 10)

  return Number.isFinite(major) ? major : undefined
}

// No command bundles the polyfill by default, so code written against
// `browser` throws on a Chromium too old to have it. This names that.
export class WarnBrowserGlobalWithoutPolyfill {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']
  public readonly devSession?: boolean
  public readonly command?: BrowserGlobalWarningCommand

  constructor(
    options: PluginInterface & {command?: BrowserGlobalWarningCommand}
  ) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.devSession = options.devSession
    this.command = options.command
  }

  apply(compiler: Compiler) {
    if (!compiler?.hooks?.thisCompilation) return

    const inDevSession =
      compiler.options.mode === 'development' && this.devSession !== false

    compiler.hooks.thisCompilation.tap(
      'compatibility:warn-browser-global',
      (compilation) => {
        if (!compilation?.hooks?.processAssets) return

        compilation.hooks.processAssets.tap(
          {
            name: 'compatibility:warn-browser-global',
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT + 100
          },
          () => {
            if (compilation.errors.length > 0) return

            try {
              const manifest = getManifestContent(
                compilation,
                this.manifestPath
              ) as {minimum_chrome_version?: unknown; devtools_page?: unknown}
              if (declaresNativeBrowserNamespace(manifest)) return

              const floor = nativeBrowserNamespaceFloor(manifest)

              // A dev session runs a current browser, which has the plain
              // namespace. Only the devtools_page floor is still ahead of it.
              if (
                inDevSession &&
                floor !== NATIVE_BROWSER_NAMESPACE_CHROMIUM_DEVTOOLS
              ) {
                return
              }

              const scan = compilation as unknown as ScanCompilation
              const scripts = offendingScripts(scan)
              if (!scripts.length) return

              const sources = sourcesBehind(
                scan,
                scripts,
                path.dirname(this.manifestPath)
              )
              const text = messages.browserGlobalWithoutPolyfill(
                this.browser,
                sources.length ? sources : scripts,
                floor,
                {
                  command: this.command || (inDevSession ? 'dev' : 'build'),
                  declaredMinimum: declaredMinimumOf(manifest)
                }
              )

              const WebpackErrorCtor = compiler.rspack?.WebpackError
              const warning = WebpackErrorCtor
                ? new WebpackErrorCtor(text)
                : (new Error(text) as Error)
              warning.name = 'BrowserGlobalWithoutPolyfillWarning'
              if (!compilation.warnings) compilation.warnings = []

              compilation.warnings.push(
                warning as (typeof compilation.warnings)[number]
              )
            } catch {
              // Diagnostics only, never fail the compile over the scan
            }
          }
        )
      }
    )
  }
}
