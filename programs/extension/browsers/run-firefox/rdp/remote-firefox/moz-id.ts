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
