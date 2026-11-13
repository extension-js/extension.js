// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {MessagingClient} from './messaging-client'

// Fallback banner-host picker: adopt a moz-extension:// host ONLY when exactly
// one distinct candidate exists; otherwise refuse to guess and return undefined.
export function pickMozExtensionHost(
  targetUrls: Array<string | undefined>
): string | undefined {
  const hosts = targetUrls
    .map((u) => {
      try {
        return u?.startsWith('moz-extension://') ? new URL(u).host : undefined
      } catch {
        return undefined
      }
    })
    .filter((h): h is string => !!h)

  const unique = Array.from(new Set(hosts))

  return unique.length === 1 ? unique[0] : undefined
}

export async function deriveMozExtensionId(
  client: MessagingClient
): Promise<string | undefined> {
  try {
    const targets = (await client.getTargets()) as Array<{url?: string}>

    return pickMozExtensionHost((targets || []).map((t) => t?.url))
  } catch {
    return undefined
  }
}

// Firefox serves an add-on from a per-profile UUID host that the add-on id
// does not reveal. The manifest url it lists for the add-on carries it.
export function extensionBaseFromManifestUrl(
  manifestUrl: unknown
): string | undefined {
  const found = /^moz-extension:\/\/([0-9A-Za-z-]{8,64})\/manifest\.json$/.exec(
    String(manifestUrl || '')
  )

  return found ? `moz-extension://${found[1]}/` : undefined
}

interface ListedAddon {
  id?: unknown
  manifestURL?: unknown
}

// The install answer may carry the add-on id or, on the fallback, the host
// itself, so either one names the add-on here.
export function pickExtensionBaseUrl(
  addons: readonly ListedAddon[],
  extensionId: string
): string | undefined {
  for (const addon of addons) {
    const base = extensionBaseFromManifestUrl(addon?.manifestURL)
    if (!base) continue

    if (
      String(addon?.id || '') === extensionId ||
      base === `moz-extension://${extensionId}/`
    ) {
      return base
    }
  }

  return undefined
}

export async function readExtensionBaseUrl(
  client: {request: (payload: Record<string, unknown>) => Promise<unknown>},
  extensionId: string | undefined
): Promise<string | undefined> {
  if (!extensionId) return undefined

  try {
    const reply = (await client.request({to: 'root', type: 'listAddons'})) as {
      addons?: ListedAddon[]
    }

    return pickExtensionBaseUrl(reply?.addons || [], extensionId)
  } catch {
    return undefined
  }
}
