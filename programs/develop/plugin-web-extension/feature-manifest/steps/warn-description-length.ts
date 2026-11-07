// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler, WebpackError} from '@rspack/core'
import {humanLine} from '../../../dev-server/lifecycle-stream'
import {
  isChromiumBasedBrowser,
  isWebkitBasedBrowser
} from '../../../lib/constants'
import {parseJsonSafe} from '../../../lib/parse-json-safe'
import type {DevOptions} from '../../../types'
import {getOriginalManifestContent} from '../manifest-lib/manifest'
import * as messages from '../messages'

// App Store Connect refuses an upload whose manifest description runs past
// 112 characters (Apple error 90849), Chrome caps the same field at 132.
export const APP_STORE_DESCRIPTION_LIMIT = 112
export const CHROME_DESCRIPTION_LIMIT = 132

export interface DescriptionRule {
  limit: number
  store: string
  required: boolean
}

export interface DescriptionLimitHit {
  kind: 'missing' | 'over'
  length: number
  rule: DescriptionRule
}

export function descriptionRuleFor(browser: string): DescriptionRule | null {
  if (isWebkitBasedBrowser(browser)) {
    return {
      limit: APP_STORE_DESCRIPTION_LIMIT,
      store: 'App Store Connect',
      required: true
    }
  }

  if (isChromiumBasedBrowser(browser)) {
    return {
      limit: CHROME_DESCRIPTION_LIMIT,
      store: 'the Chrome Web Store',
      required: false
    }
  }

  return null
}

export function findDescriptionLimitHit(
  manifest: unknown,
  browser: string
): DescriptionLimitHit | null {
  const rule = descriptionRuleFor(browser)
  if (!rule) return null

  const field = (manifest as {description?: unknown} | null | undefined)
    ?.description
  const description = typeof field === 'string' ? field : ''
  const text = description.trim()

  if (!text) {
    return rule.required ? {kind: 'missing', length: 0, rule} : null
  }

  // A __MSG_key__ value resolves through _locales, whose text this step
  // does not read, so its length says nothing about the shipped string.
  if (/^__MSG_[^_]+__$/.test(text)) return null

  if (description.length <= rule.limit) return null

  return {kind: 'over', length: description.length, rule}
}

export class WarnDescriptionLength {
  public static readonly name: string = 'manifest:warn-description-length'
  private readonly browser: string
  // Dev recompiles re-read the same field on every save, one line per distinct
  // hit for the life of the plugin is enough; production prints every build.
  private reported = new Set<string>()

  constructor(options: {browser: DevOptions['browser']}) {
    this.browser = String(options.browser || 'chrome')
  }

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      WarnDescriptionLength.name,
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: WarnDescriptionLength.name,
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT
          },
          () => {
            const original = getOriginalManifestContent(compilation)
            if (!original) return

            const hit = findDescriptionLimitHit(
              parseJsonSafe(original),
              this.browser
            )
            if (!hit) return

            const signature = `${hit.kind}\0${hit.length}`

            if (compiler.options.mode === 'development') {
              if (this.reported.has(signature)) return

              this.reported.add(signature)
            }

            const message =
              hit.kind === 'missing'
                ? messages.manifestDescriptionMissingForStore(
                    this.browser,
                    hit.rule.store,
                    hit.rule.limit
                  )
                : messages.manifestDescriptionOverStoreLimit(
                    this.browser,
                    hit.length,
                    hit.rule.limit,
                    hit.rule.store
                  )

            humanLine(message)
            const warn = new WebpackError(message) as Error & {
              file?: string
              name?: string
            }
            warn.name = 'ManifestDescriptionWarning'
            warn.file = 'manifest.json'
            compilation.warnings.push(warn)
          }
        )
      }
    )
  }
}
