import * as messages from '../../../browsers-lib/messages'
import {MessagingClient} from './messaging-client'

const TARGET_SCAN_INTERVAL_MS = 250

export async function selectActors(
  client: MessagingClient,
  urlToInspect: string
): Promise<{tabActor: string; consoleActor: string}> {
  const deadline = Date.now() + 10000
  let triedAddTab = false

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

    // 1) Exact URL match
    for (const target of allTargets) {
      if (
        target &&
        typeof target.url === 'string' &&
        target.url === urlToInspect &&
        target.actor
      ) {
        return {
          tabActor: target.actor,
          consoleActor: target.consoleActor || target.actor
        }
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

    // 3) Fallback to first valid target with an actor
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

    await new Promise((r) => setTimeout(r, TARGET_SCAN_INTERVAL_MS))
  }

  throw new Error(messages.sourceInspectorNoTabTargetFound())
}
