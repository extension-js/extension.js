// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler, WebpackError} from '@rspack/core'
import {isChromiumBasedBrowser} from '../../../lib/constants'
import {parseJsonSafe} from '../../../lib/parse-json-safe'
import type {DevOptions} from '../../../types'
import {
  filterKeysForThisBrowser,
  getOriginalManifestContent
} from '../manifest-lib/manifest'
import * as messages from '../messages'
import {
  declaredHostPatterns,
  devInjectedHostPatterns,
  optionalHostPatterns
} from './apply-dev-defaults-lib/dev-injected-hosts'

// Firefox reads a content script match as a host permission and Chromium does
// not, so these stay without a host on Chrome when the manifest names none.
export const HOST_GATED_PERMISSIONS = [
  'scripting',
  'cookies',
  'webRequest'
] as const

export interface ContentScriptOnlyHostAccess {
  matches: string[]
  permissions: string[]
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

export function findContentScriptOnlyHostAccess(
  manifest: unknown,
  browser: string
): ContentScriptOnlyHostAccess | null {
  if (!isChromiumBasedBrowser(browser)) return null
  if (!manifest || typeof manifest !== 'object') return null

  const source = manifest as Record<string, unknown>
  if (source.manifest_version !== 3) return null

  const matches = [...devInjectedHostPatterns(source)]
  if (!matches.length) return null

  const declared = stringList(source.permissions)
  const permissions = HOST_GATED_PERMISSIONS.filter((permission) =>
    declared.includes(permission)
  )
  if (!permissions.length) return null

  // Any host of its own, even an optional one or the invoked tab, means the
  // author chose where these APIs reach, and the build has nothing to add.
  if (declaredHostPatterns(source).length) return null
  if (optionalHostPatterns(source).length) return null

  const grants = [...declared, ...stringList(source.optional_permissions)]
  if (grants.includes('activeTab')) return null

  return {matches, permissions}
}

export class WarnContentScriptHostAccess {
  public static readonly name: string =
    'manifest:warn-content-script-host-access'
  private readonly browser: string
  // A dev session recompiles on every save, so it gets one line per distinct
  // hit for the life of the plugin. A production build prints every time.
  private reported = new Set<string>()

  constructor(options: {browser: DevOptions['browser']}) {
    this.browser = String(options.browser || 'chrome')
  }

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      WarnContentScriptHostAccess.name,
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: WarnContentScriptHostAccess.name,
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT
          },
          () => {
            const original = getOriginalManifestContent(compilation)
            if (!original) return

            // The dev build grants the matched hosts itself, so the question
            // is asked of the manifest as written, before that patch.
            const hit = findContentScriptOnlyHostAccess(
              filterKeysForThisBrowser(
                parseJsonSafe(original),
                this.browser as DevOptions['browser']
              ),
              this.browser
            )
            if (!hit) return

            const signature = `${hit.permissions.join(',')}\0${hit.matches.join(',')}`

            if (compiler.options.mode === 'development') {
              if (this.reported.has(signature)) return

              this.reported.add(signature)
            }

            const warn = new WebpackError(
              messages.contentScriptMatchesGrantNoHostOnChromium(
                hit.permissions,
                hit.matches
              )
            ) as Error & {file?: string; name?: string}
            warn.name = 'ContentScriptHostAccessWarning'
            warn.file = 'manifest.json'
            compilation.warnings.push(warn)
          }
        )
      }
    )
  }
}
