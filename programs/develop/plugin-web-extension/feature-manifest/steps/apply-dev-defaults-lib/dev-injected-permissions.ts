// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

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
  tabs: 'the tab url, title and favIconUrl fields come back empty without it'
}

// Source that touches the gated part. tabs.query({active: true}) followed by
// tabs.sendMessage ships fine without "tabs", so only a field read or a url
// or title query filter earns the warning. document.title and import.meta.url
// are the two lookalikes a page script carries on its own.
const GATED_USES: Record<string, RegExp[]> = {
  tabs: [
    /(?<!\b(?:document|meta)\s*)\.\s*(?:url|pendingUrl|title|favIconUrl)\b/,
    /\{[^{}:]*\b(?:url|pendingUrl|title|favIconUrl)\b[^{}:]*\}\s*(?:=|\))/,
    /\btabs\s*\.\s*query\s*\(\s*\{[^{}]*\b(?:url|title)\s*:/
  ]
}

export function usesGatedPart(api: string, source: string): boolean {
  const patterns = GATED_USES[api]

  return !patterns || patterns.some((pattern) => pattern.test(source))
}

export function partiallyGatedNote(api: string): string {
  const note = PARTIALLY_GATED_APIS[api]

  return note ? ` Only part of the namespace is gated: ${note}.` : ''
}

// The whole warning for a partially gated namespace, or null when the
// namespace is fully gated and the caller's own text applies.
export function partiallyGatedWarning(
  api: string,
  relative: string,
  declared: ReadonlySet<string> = new Set()
): string | null {
  const note = PARTIALLY_GATED_APIS[api]
  if (!note) return null

  const activeTab = declared.has('activeTab')
    ? ' activeTab covers only the tab the user invoked the extension on.'
    : ''

  return (
    `manifest.json does not declare the "${api}" permission, but ` +
    `${relative} reads fields it gates. It works in dev only because dev ` +
    `injects "${api}": packaged, ${note}.${activeTab} ` +
    `Add "${api}" to permissions in manifest.json.`
  )
}
