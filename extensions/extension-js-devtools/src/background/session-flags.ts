// ██████╗ ███████╗██╗   ██╗████████╗ ██████╗  ██████╗ ██╗     ███████╗
// ██╔══██╗██╔════╝██║   ██║╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██╔════╝
// ██║  ██║█████╗  ██║   ██║   ██║   ██║   ██║██║   ██║██║     ███████╗
// ██║  ██║██╔══╝  ╚██╗ ██╔╝   ██║   ██║   ██║██║   ██║██║     ╚════██║
// ██████╔╝███████╗ ╚████╔╝    ██║   ╚██████╔╝╚██████╔╝███████╗███████║
// ╚═════╝ ╚══════╝  ╚═══╝     ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// The build ships this file from public/ with noOpen false. Under --no-open
// the CLI stages a per-session copy of this extension and overwrites the file
// beside its manifest, so the shared dist always says the session may open.
export const SESSION_FLAGS_FILE = 'extension-js-session.json'

export type SessionFlags = {
  noOpen: boolean
}

export function parseSessionFlags(raw: unknown): SessionFlags {
  const record =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {noOpen: record.noOpen === true}
}

export async function readSessionFlags(): Promise<SessionFlags> {
  try {
    // A root-relative fetch resolves against the extension origin in both a
    // service worker and a background page.
    const response = await fetch(`/${SESSION_FLAGS_FILE}`)
    if (!response.ok) return parseSessionFlags(undefined)
    return parseSessionFlags(await response.json())
  } catch {
    // No file, or a runtime without fetch for extension URLs: open as before.
    return parseSessionFlags(undefined)
  }
}
