// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Manifest} from '../../../types'

/**
 * AMO rejects every new add-on submitted since 2025-11-03 whose manifest
 * lacks `browser_specific_settings.gecko.data_collection_permissions`
 * (add-ons that transmit nothing must declare `{"required": ["none"]}`),
 * and Mozilla has announced the key becomes mandatory for ALL add-ons
 * during 2026. Firefox parses the key from 140 (desktop) / 142 (Android)
 * on both MV2 and MV3, so declaring it is safe everywhere.
 *
 * Returns true when the resolved Gecko manifest carries no such
 * declaration, so the build can surface a store-readiness warning instead
 * of letting the author discover the rejection at submission time.
 */
export function missingGeckoDataCollectionPermissions(
  manifest: Manifest
): boolean {
  // The canonical Manifest type tracks @types/chrome, which has no
  // browser_specific_settings shape, so read it structurally.
  const bss = (
    manifest as {
      browser_specific_settings?: {
        gecko?: {data_collection_permissions?: unknown}
      }
    }
  ).browser_specific_settings

  const declaration = bss?.gecko?.data_collection_permissions
  return declaration == null || typeof declaration !== 'object'
}
