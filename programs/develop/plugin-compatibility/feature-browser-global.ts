//  ██████╗ ██████╗ ███╗   ███╗██████╗  █████╗ ████████╗██╗██████╗ ██╗██╗     ██╗████████╗██╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██╔══██╗╚══██╔══╝██║██╔══██╗██║██║     ██║╚══██╔══╝╚██╗ ██╔╝
// ██║     ██║   ██║██╔████╔██║██████╔╝███████║   ██║   ██║██████╔╝██║██║     ██║   ██║    ╚████╔╝
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██╔══██║   ██║   ██║██╔══██╗██║██║     ██║   ██║     ╚██╔╝
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║  ██║   ██║   ██║██████╔╝██║███████╗██║   ██║      ██║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝╚═════╝ ╚═╝╚══════╝╚═╝   ╚═╝      ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import {Compilation, type Compiler} from '@rspack/core'
import {scannableSourcePath} from '../plugin-web-extension/feature-manifest/steps/apply-dev-defaults-lib/dev-injected-hosts'
import {
  type EmittedCompilation,
  type EmittedModule,
  emittedFilesOf,
  readEmittedScripts,
  readProjectSource
} from '../plugin-web-extension/feature-manifest/steps/apply-dev-defaults-lib/emitted-evidence'
import type {DevOptions, PluginInterface} from '../types'
import {
  mentionsBrowserName,
  referencesBrowserGlobal
} from './compatibility-lib/free-browser-references'
import * as messages from './compatibility-lib/messages'

const HOT_UPDATE_RE = /\.hot-update\.js$/

interface ScanCompilation extends EmittedCompilation {
  modules: Iterable<EmittedModule>
}

function offendingScripts(compilation: ScanCompilation): string[] {
  const offenders: string[] = []

  for (const [name, text] of readEmittedScripts(compilation)) {
    if (HOT_UPDATE_RE.test(name)) continue
    if (referencesBrowserGlobal(text)) offenders.push(name)
  }

  return offenders
}

// The project files bundled into an offending script that spell the name
// out, so the warning points at source the author wrote, not at dist.
function sourcesBehind(
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

      const text = readProjectSource(resource)
      if (text === undefined || !mentionsBrowserName(text)) continue

      sources.add(path.relative(manifestDir, resource).split(path.sep).join('/'))
    }
  }

  return [...sources].sort()
}

// Dev and start provide `browser` through the polyfill by default and build
// does not, so a project written against it runs all through development and
// ships a bundle that throws on first use. This names that before it ships.
export class WarnBrowserGlobalWithoutPolyfill {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']
  public readonly devSession?: boolean

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.devSession = options.devSession
  }

  apply(compiler: Compiler) {
    if (!compiler?.hooks?.thisCompilation) return

    if (compiler.options.mode === 'development' && this.devSession !== false) {
      return
    }

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
                sources.length ? sources : scripts
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
