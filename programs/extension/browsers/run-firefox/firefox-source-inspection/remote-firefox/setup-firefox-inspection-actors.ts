// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as messages from '../../../browsers-lib/messages'
import {MessagingClient} from './messaging-client'

const TARGET_SCAN_INTERVAL_MS = 250

/** When we intend to inspect a real document URL, never bind to an unrelated tab (e.g. about:blank) while the target list is still catching up after navigation. */
function shouldDeferFallbackUntilExactMatch(normalizedUrl: string): boolean {
  try {
    const parsed = new URL(String(normalizedUrl || ''))
    return (
      parsed.protocol === 'http:' ||
      parsed.protocol === 'https:' ||
      parsed.protocol === 'file:' ||
      parsed.protocol === 'moz-extension:' ||
      parsed.protocol === 'chrome-extension:' ||
      parsed.protocol === 'edge:'
    )
  } catch {
    return false
  }
}

/**
 * When listTabs still reports about:blank but navigation already finished, match by live document URL.
 */
async function findActorsMatchingLiveHref(
  client: MessagingClient,
  allTargets: Array<{
    url?: string
    actor?: string
    consoleActor?: string
  }>,
  normalizedUrlToInspect: string
): Promise<{tabActor: string; consoleActor: string} | null> {
  const withActor = allTargets.filter((t) => t && typeof t.actor === 'string')
  for (let i = withActor.length - 1; i >= 0; i--) {
    const target = withActor[i]
    const tabActor = String(target.actor)
    let consoleActor: string | undefined =
      typeof target.consoleActor === 'string' && target.consoleActor.length > 0
        ? target.consoleActor
        : undefined
    if (!consoleActor || consoleActor === tabActor) {
      try {
        const detail = await client.getTargetFromDescriptor(tabActor)
        if (
          typeof detail.consoleActor === 'string' &&
          detail.consoleActor.length > 0
        ) {
          consoleActor = detail.consoleActor
        }
      } catch {
        // ignore
      }
    }
    if (!consoleActor) {
      continue
    }
    try {
      const hrefRaw = await client.evaluate(
        consoleActor,
        'String(location.href || "")'
      )
      const href = typeof hrefRaw === 'string' ? hrefRaw : String(hrefRaw ?? '')
      if (normalizeInspectableUrl(href) === normalizedUrlToInspect) {
        return {tabActor, consoleActor}
      }
    } catch {
      // ignore
    }
  }
  return null
}

function normalizeInspectableUrl(rawUrl: string): string {
  try {
    const parsed = new URL(String(rawUrl || ''))
    if (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.pathname === '/'
    ) {
      parsed.pathname = ''
    }
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return String(rawUrl || '')
      .trim()
      .replace(/\/$/, '')
  }
}

export async function selectActors(
  client: MessagingClient,
  urlToInspect: string
): Promise<{tabActor: string; consoleActor: string}> {
  const deadline = Date.now() + 10000
  let triedAddTab = false
  const normalizedUrlToInspect = normalizeInspectableUrl(urlToInspect)

  while (Date.now() < deadline) {
    const allTargets =
      ((await client.getTargets()) as unknown as Array<{
        url?: string
        type?: string
        outerWindowId?: number
        outerWindowID?: number
        actor?: string
        consoleActor?: string
      }>) || []

    // 1) Exact URL match.
    // Prefer the newest matching tab when duplicate URLs exist.
    const exactMatches = allTargets.filter(
      (target) =>
        target &&
        typeof target.url === 'string' &&
        normalizeInspectableUrl(target.url) === normalizedUrlToInspect &&
        target.actor
    )
    const exactMatch =
      exactMatches.length > 0
        ? exactMatches[exactMatches.length - 1]
        : undefined
    if (exactMatch?.actor) {
      return {
        tabActor: exactMatch.actor,
        consoleActor: exactMatch.consoleActor || exactMatch.actor
      }
    }

    // 1b) Live document URL (listTabs URL can lag behind navigation).
    if (shouldDeferFallbackUntilExactMatch(normalizedUrlToInspect)) {
      const livePair = await findActorsMatchingLiveHref(
        client,
        allTargets,
        normalizedUrlToInspect
      )
      if (livePair) {
        return livePair
      }
    }

    // 2) Try to open the tab once if no match yet
    if (!triedAddTab && urlToInspect) {
      triedAddTab = true
      try {
        await client.addTab(urlToInspect)
        await new Promise((resolve) => setTimeout(resolve, 300))
        continue
      } catch (error) {
        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          const msg =
            (error as {message?: string} | undefined)?.message || String(error)
          console.warn(messages.rdpAddTabFailed(msg))
        }
      }
    }

    // 3) Fallback to first valid target with an actor — only when we are not waiting
    // for a specific navigated document. Otherwise keep scanning until an exact URL match
    // or the deadline (avoids binding to about:blank while example.com is still loading).
    if (!shouldDeferFallbackUntilExactMatch(normalizedUrlToInspect)) {
      for (const target of allTargets) {
        if (
          target &&
          (typeof target.actor === 'string' ||
            typeof target.outerWindowID === 'number' ||
            typeof target.outerWindowId === 'number')
        ) {
          return {
            tabActor: String(target.actor || ''),
            consoleActor: String(target.consoleActor || target.actor || '')
          }
        }
      }
    }

    await new Promise((r) => setTimeout(r, TARGET_SCAN_INTERVAL_MS))
  }

  throw new Error(messages.sourceInspectorNoTabTargetFound())
}
