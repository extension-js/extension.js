// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

// The single source for the permissions the dev build injects. The manifest
// patch, the optional-promotion warning and the undeclared-use warning all
// read this, so a permission added here cannot reach the dist manifest
// without every warning covering it. Never inline a permission elsewhere.
const DEV_INJECTED_PERMISSIONS_MV3 = [
  'scripting',
  'tabs',
  'management',
  'storage'
] as const

const DEV_INJECTED_PERMISSIONS_MV2 = ['tabs', 'storage'] as const

export function devInjectedPermissions(
  manifestVersion: unknown
): readonly string[] {
  return manifestVersion === 3
    ? DEV_INJECTED_PERMISSIONS_MV3
    : DEV_INJECTED_PERMISSIONS_MV2
}

// The gated part of a namespace that is reachable without the permission.
// For these the warning must not claim the packaged build fails outright:
// chrome.tabs.sendMessage is the most common use and needs no permission.
const PARTIALLY_GATED_APIS: Record<string, string> = {
  tabs:
    'the tab url, title and favIconUrl fields and the url and title query ' +
    'filters come back empty without it, while other chrome.tabs calls work ' +
    'packaged without it'
}

export function partiallyGatedNote(api: string): string {
  const note = PARTIALLY_GATED_APIS[api]
  return note ? ` Only part of the namespace is gated: ${note}.` : ''
}

// The whole warning for a partially gated namespace, or null when the
// namespace is fully gated and the caller's own text applies.
export function partiallyGatedWarning(
  api: string,
  relative: string
): string | null {
  const note = PARTIALLY_GATED_APIS[api]
  if (!note) return null
  return (
    `manifest.json does not declare the "${api}" permission, but ` +
    `${relative} uses chrome.${api}. The dev build injects "${api}" so ` +
    `the same code may behave differently once packaged: ${note}. ` +
    `Add "${api}" to permissions in manifest.json if you read those fields.`
  )
}
