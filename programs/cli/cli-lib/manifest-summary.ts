export type ManifestSummary = {
  mv: 2 | 3
  permissions_count: number
  optional_permissions_count: number
  host_permissions_count: number
  uses_all_urls: boolean
  uses_declarative_net_request: boolean
  background_type: 'service_worker' | 'event_page' | 'none'
  content_scripts_count: number
  has_devtools_page: boolean
  has_action_popup: boolean
}

export function summarizeManifest(manifest: any): ManifestSummary {
  // Determine manifest version
  const mv: 2 | 3 = manifest?.manifest_version === 2 ? 2 : 3

  // Extract permissions arrays, defaulting to empty arrays if not present
  const permissions: string[] = Array.isArray(manifest?.permissions)
    ? manifest.permissions
    : []
  const optionalPermissions: string[] = Array.isArray(
    manifest?.optional_permissions
  )
    ? manifest.optional_permissions
    : []
  const hostPermissions: string[] = Array.isArray(manifest?.host_permissions)
    ? manifest.host_permissions
    : []

  // Check for <all_urls> usage
  const usesAllUrls: boolean = [...permissions, ...hostPermissions].includes(
    '<all_urls>'
  )

  // Check for declarativeNetRequest permissions
  const usesDeclarativeNetRequest: boolean =
    permissions.includes('declarativeNetRequest') ||
    permissions.includes('declarativeNetRequestWithHostAccess')

  // Determine background type
  const background = manifest?.background
  let backgroundType: 'service_worker' | 'event_page' | 'none' = 'none'
  if (mv === 3 && background?.service_worker) {
    backgroundType = 'service_worker'
  } else if (
    mv === 2 &&
    ((Array.isArray(background?.scripts) && background.scripts.length > 0) ||
      background?.page)
  ) {
    backgroundType = 'event_page'
  }

  // Count content scripts
  const contentScriptsCount: number = Array.isArray(manifest?.content_scripts)
    ? manifest.content_scripts.length
    : 0

  // Check for devtools page and action popup
  const hasDevtoolsPage: boolean = Boolean(manifest?.devtools_page)
  const hasActionPopup: boolean = Boolean(manifest?.action?.default_popup)

  return {
    mv,
    permissions_count: permissions.length,
    optional_permissions_count: optionalPermissions.length,
    host_permissions_count: hostPermissions.length,
    uses_all_urls: usesAllUrls,
    uses_declarative_net_request: usesDeclarativeNetRequest,
    background_type: backgroundType,
    content_scripts_count: contentScriptsCount,
    has_devtools_page: hasDevtoolsPage,
    has_action_popup: hasActionPopup
  }
}
