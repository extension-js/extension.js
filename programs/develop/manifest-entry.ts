// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {
  type LocalizableManifest as LocalizableManifestShape,
  type LocalizedNameOptions as LocalizedNameOptionsShape,
  resolveLocalizedManifestName as resolveLocalizedName
} from './lib/localized-manifest-name'
import {
  type FilterKeysOptions as FilterKeysOptionsShape,
  filterKeysForThisBrowser as filterKeys,
  findDroppedVendorKeys as findDroppedKeys
} from './lib/manifest-utils'
import {
  webkitDroppedSurfacePages as droppedSurfacePages,
  webkitUnsupportedManifestKeys as unsupportedManifestKeys,
  webkitUnsupportedPermissions as unsupportedPermissions,
  type WebkitDroppedPage as WebkitDroppedPageShape,
  type WebkitUnsupportedKey as WebkitUnsupportedKeyShape
} from './plugin-web-extension/feature-manifest/manifest-lib/webkit-unsupported-keys'

/** @deprecated The `extension-develop/manifest` entry is removed in the next minor. */
export type LocalizableManifest = LocalizableManifestShape
/** @deprecated The `extension-develop/manifest` entry is removed in the next minor. */
export type LocalizedNameOptions = LocalizedNameOptionsShape
/** @deprecated The `extension-develop/manifest` entry is removed in the next minor. */
export const resolveLocalizedManifestName = resolveLocalizedName
/** @deprecated The `extension-develop/manifest` entry is removed in the next minor. */
export type FilterKeysOptions = FilterKeysOptionsShape
/** @deprecated The `extension-develop/manifest` entry is removed in the next minor. */
export const filterKeysForThisBrowser = filterKeys
/** @deprecated The `extension-develop/manifest` entry is removed in the next minor. */
export const findDroppedVendorKeys = findDroppedKeys
/** @deprecated The `extension-develop/manifest` entry is removed in the next minor. */
export type WebkitDroppedPage = WebkitDroppedPageShape
/** @deprecated The `extension-develop/manifest` entry is removed in the next minor. */
export type WebkitUnsupportedKey = WebkitUnsupportedKeyShape
/** @deprecated The `extension-develop/manifest` entry is removed in the next minor. */
export const webkitDroppedSurfacePages = droppedSurfacePages
/** @deprecated The `extension-develop/manifest` entry is removed in the next minor. */
export const webkitUnsupportedManifestKeys = unsupportedManifestKeys
/** @deprecated The `extension-develop/manifest` entry is removed in the next minor. */
export const webkitUnsupportedPermissions = unsupportedPermissions
