// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import type {MessagingClient} from './messaging-client'

// Pure core — no RDP client, unit-testable. Pick the `moz-extension://` host to
// show in the dev banner from the set of open target URLs.
//
// This is a FALLBACK only: the authoritative id comes from the RDP
// `installTemporaryAddon` reply. It is reached solely when that reply carried no
// id, and its output feeds nothing but the banner string. Because a
// `moz-extension://` host is a per-session UUID (not the add-on id, and not
// otherwise attributable to a specific add-on), there is no way to tell OUR host
// apart from a pre-existing add-on's host once more than one is present.
//
// So the rule is deliberately conservative: adopt a host ONLY when it is
// unambiguous (exactly one distinct `moz-extension://` host). With zero or
// multiple candidates we refuse to guess and return undefined — the banner then
// prints without an id rather than risk printing someone else's host.
export function pickMozExtensionHost(
  targetUrls: Array<string | undefined>
): string | undefined {
  const hosts = targetUrls
    .map((u) => {
      try {
        return u && u.startsWith('moz-extension://')
          ? new URL(u).host
          : undefined
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
