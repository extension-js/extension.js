// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import type {Compilation} from '@rspack/core'
import {
  filterKeysForThisBrowser,
  isStaticTheme,
  isStaticThemeSource
} from '../../../lib/manifest-utils'
import {parseJsonSafe} from '../../../lib/parse-json-safe'
import type {DevOptions, Manifest} from '../../../types'
import {
  dropPageAction,
  foldActionIntoBrowserAction,
  foldBrowserActionIntoAction,
  foldSidebarKeyForBrowser,
  shouldDropPageAction
} from '../../shared/html-surfaces'
import {getManifestOverrides} from '../manifest-overrides'
import {dropMv2ObjectPolicy} from '../manifest-overrides/mv2/content_security_policy'
import {dropMv2HostKeys} from '../manifest-overrides/mv2/host_permissions'
import {reportEdgeEmbeddedOptions} from './edge-options-notice'
import {
  dropGeckoUnsupportedKeys,
  reportGeckoUnsupportedKeys
} from './filter-keys-gecko'
import {
  dropWebkitUnsupportedKeys,
  reportWebkitDroppedKeys
} from './filter-keys-safari'
import {
  applyIconVariantsFallback,
  reportIconVariantsFallback
} from './icon-variants-fallback'

// The manifest as the author wrote it rides per compilation, since later
// steps rewrite the asset and the checks on authored fields need the source.
const authoredManifestStore = new WeakMap<
  Compilation,
  {text: string; parsed?: Manifest}
>()

// Text handed over by steps outside this folder. Only a compilation that
// cannot hand its assets back, a spec double, is ever answered from it.
const handedOverManifestText = new WeakMap<Compilation, string>()

function readAssetSource(asset: {source?: unknown} | null | undefined): string {
  if (!asset) return ''

  const source = asset.source

  if (typeof source === 'string') return source

  if (typeof source === 'function') {
    const out = source()

    return typeof out === 'string' ? out : String(out || '')
  }

  if (source && typeof (source as {source?: unknown}).source === 'function') {
    const out = (source as {source: () => unknown}).source()

    return typeof out === 'string' ? out : String(out || '')
  }

  return ''
}

// The manifest.json asset is the one copy every step and every project
// plugin shares, so whatever edited it last is what the next reader gets.
export function readManifestAssetText(
  compilation: Compilation
): string | undefined {
  const getAsset = compilation.getAsset

  if (typeof getAsset === 'function') {
    const text = readAssetSource(
      getAsset.call(compilation, 'manifest.json') as
        | {source?: unknown}
        | null
        | undefined
    )

    if (text) return text
  }

  return readAssetSource(compilation.assets?.['manifest.json']) || undefined
}

export function setOriginalManifestContent(
  compilation: Compilation,
  source: string
): void {
  authoredManifestStore.set(compilation, {text: source})
}

export function getOriginalManifestContent(
  compilation: Compilation
): string | undefined {
  return authoredManifestStore.get(compilation)?.text
}

// One parse serves every check that only reads the authored manifest.
// Callers must not change the object they get.
export function getOriginalManifest(
  compilation: Compilation
): Manifest | undefined {
  const entry = authoredManifestStore.get(compilation)
  if (!entry) return undefined

  entry.parsed ??= parseJsonSafe(entry.text) as Manifest

  return entry.parsed
}

// A theme is told from the manifest as authored, since the dev patches add
// keys no theme carries. The disk is read only when no step emitted one.
export function isStaticThemeCompilation(
  compilation: Compilation,
  manifestPath: string | undefined,
  browser: DevOptions['browser'] | string | undefined
): boolean {
  let authored: Manifest | undefined

  try {
    authored = getOriginalManifest(compilation)
  } catch {
    return false
  }

  if (!authored) return isStaticThemeSource(manifestPath, browser)

  return isStaticTheme(
    filterKeysForThisBrowser(authored, browser as DevOptions['browser'])
  )
}

// Kept for the steps outside this folder that still call it. Those steps
// update the asset in the same breath, and the asset is what gets read.
export function setCurrentManifestContent(
  compilation: Compilation,
  source: string
): void {
  handedOverManifestText.set(compilation, source)
}

// Kept for the same callers: the text of the manifest.json asset.
export function getCurrentManifestContent(
  compilation: Compilation
): string | undefined {
  if (typeof compilation.getAsset === 'function') {
    return readManifestAssetText(compilation)
  }

  return handedOverManifestText.get(compilation)
}

export function getManifestContent(
  compilation: Compilation,
  manifestPath: string
): Manifest {
  const text =
    readManifestAssetText(compilation) ??
    getOriginalManifestContent(compilation)

  if (text) return parseJsonSafe(text)

  // No step has emitted a manifest for this compilation yet, so the file
  // the author saved is the only copy there is.
  return parseJsonSafe(fs.readFileSync(manifestPath, 'utf8'))
}

// Re-export the canonical resolver so emission, feature-scripts, and
// feature-html share one implementation, incl. Safari/webkit resolution.
export {filterKeysForThisBrowser}

// The applied override tree rides out with the manifest so a caller that
// wants to report on it never computes a second one from another input.
export function buildCanonicalManifestWithOverrides(
  manifestPath: string,
  manifest: Manifest,
  browser: DevOptions['browser'],
  projectPath?: string
): {manifest: Manifest; overrides: string} {
  const filteredManifest = filterKeysForThisBrowser(
    manifest,
    browser
  ) as Manifest

  // Chromium dropped page_action with Manifest V3; keeping the key would
  // ship a page for a surface that never shows.
  const withoutPageAction = shouldDropPageAction(filteredManifest, browser)
    ? dropPageAction(filteredManifest)
    : filteredManifest

  // Manifest V3 reads the toolbar surface under `action` on every browser, so
  // the old key folds into it before the overrides rewrite its page.
  const forOverrides = foldBrowserActionIntoAction(withoutPageAction)
  const overrides = getManifestOverrides(
    manifestPath,
    forOverrides,
    projectPath
  )

  // The filtered source is spread under the overrides, so the MV2 host keys
  // and CSP object the overrides translated need dropping here as well.
  const canonical = dropMv2ObjectPolicy(
    dropMv2HostKeys({
      ...forOverrides,
      ...JSON.parse(overrides)
    })
  ) as Manifest

  // Each family reads one key of the sidebar pair, and Manifest V2 reads the
  // toolbar button under browser_action. Both renames run after the overrides
  // so the key that ships names the page the pipeline already emitted.
  const translated = foldActionIntoBrowserAction(
    foldSidebarKeyForBrowser(canonical, browser)
  )

  // Safari inherits chromium keys, so the drop runs last. An override that
  // rewrites a side_panel or sandbox path would otherwise put the key back.
  const webkit = dropWebkitUnsupportedKeys(translated, browser)
  reportWebkitDroppedKeys(webkit.dropped, browser)
  reportEdgeEmbeddedOptions(webkit.manifest, browser)

  // Firefox ignores the same kind of string, and its build says so too.
  const gecko = dropGeckoUnsupportedKeys(webkit.manifest, browser)
  reportGeckoUnsupportedKeys(gecko, browser)

  // A browser that skips icon_variants draws from icons, so it needs them.
  const icons = applyIconVariantsFallback(gecko.manifest, browser)
  reportIconVariantsFallback(icons.verdicts, browser)

  return {manifest: icons.manifest, overrides}
}
