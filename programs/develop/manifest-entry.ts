// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export {
  type LocalizableManifest,
  type LocalizedNameOptions,
  resolveLocalizedManifestName
} from './lib/localized-manifest-name'
export {
  type FilterKeysOptions,
  filterKeysForThisBrowser,
  findDroppedVendorKeys
} from './lib/manifest-utils'
export {
  type WebkitDroppedPage,
  type WebkitUnsupportedKey,
  webkitDroppedSurfacePages,
  webkitUnsupportedManifestKeys,
  webkitUnsupportedPermissions
} from './plugin-web-extension/feature-manifest/manifest-lib/webkit-unsupported-keys'
