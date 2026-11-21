// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Compilation} from '@rspack/core'
import {getOriginalManifest} from '../../../lib/manifest/manifest-content'
import {
  filterKeysForThisBrowser,
  isStaticTheme,
  isStaticThemeSource
} from '../../../lib/manifest-utils'
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

// The manifest text store lives in lib, where every plugin may read it.
export {
  getCurrentManifestContent,
  getManifestContent,
  getOriginalManifest,
  getOriginalManifestContent,
  readManifestAssetText,
  setCurrentManifestContent,
  setOriginalManifestContent
} from '../../../lib/manifest/manifest-content'

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
