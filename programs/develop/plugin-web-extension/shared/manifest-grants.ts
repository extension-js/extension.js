// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export {
  declaredHostPatterns,
  devInjectedHostPatterns,
  findInjectedOnlyHostUses,
  isHostPattern,
  optionalHostPatterns
} from '../feature-manifest/manifest-lib/dev-injected-hosts'
export {
  devInjectedPermissions,
  partiallyGatedNote,
  partiallyGatedWarning,
  permissionsGrantedByHosts
} from '../feature-manifest/manifest-lib/dev-injected-permissions'
export {isWebkitUnsupportedPermission} from '../feature-manifest/manifest-lib/filter-keys-safari'
export {isStaticThemeCompilation} from '../feature-manifest/manifest-lib/manifest'
export {
  findInjectedOnlyPermissionUses,
  type PermissionScanCompilation,
  useLocation
} from '../feature-manifest/manifest-lib/permission-scan'
export {findShadowedPermission} from '../feature-manifest/manifest-lib/shadowed-declaration'
export {undeclaredPermissionWording} from '../feature-manifest/messages'
export {patchWebkitBackground} from '../feature-manifest/steps/patch-webkit-background'
// What the manifest feature knows about grants: the hosts and permissions a
// manifest declares, what a source leans on, and how a warning words it.
export {cleanMatches} from '../feature-web-resources/web-resources-lib/clean-matches'
