// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as messages from '../../../browsers-lib/messages'
import type {MessagingClient} from './messaging-client'
import type {RdpEvalResponse} from './rdp-types'

export type AddonRuntimeTarget = {
  consoleActor: string
  targetActor: string
  addonId: string
}

type ListAddonsResponse = {
  addons?: Array<{
    id?: string
    actor?: string
    isWebExtension?: boolean
    manifestURL?: string
  }>
}

// Locate the addon's background descriptor and resolve it into a console actor
// we can evaluate against. Returns undefined if the addon isn't installed yet
// or the descriptor doesn't expose a console actor (e.g. cold event page that
// couldn't be woken)
// Wrap an RDP request promise with a hard timeout. Firefox occasionally
// fails to reply to a packet (observed on content-react MV3 where
// getWatcher to the addon's webExtensionDescriptor never resolves), and a
// silent hang here strands every subsequent reinjection attempt. With a
// timeout the runtime path returns undefined and the caller falls back to
// the legacy reinstall+navigate flow that works regardless of MV2/MV3
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  return Promise.race<T>([
    promise.then((value) => {
      if (timer) clearTimeout(timer)
      return value
    }),
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(new Error(`rdp request timeout: ${label} (${timeoutMs}ms)`)),
        timeoutMs
      )
    })
  ])
}

const RDP_REQUEST_TIMEOUT_MS = 5000

export async function attachToAddonBackgroundConsole(
  client: MessagingClient,
  addonsActor: string,
  addonId: string
): Promise<AddonRuntimeTarget | undefined> {
  if (!addonsActor || !addonId) return undefined

  const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'
  let descriptorActor: string | undefined
  let listAddonsResponseSample: unknown = null

  try {
    // listAddons lives on the root actor, not on AddonsManagerActor —
    // addonsActor only handles installTemporaryAddon. The root actor
    // returns webExtensionDescriptors keyed by addon id.
    const response = (await withTimeout(
      client.request({to: 'root', type: 'listAddons'}),
      RDP_REQUEST_TIMEOUT_MS,
      'listAddons'
    )) as ListAddonsResponse

    listAddonsResponseSample = (response?.addons || []).map((entry) => ({
      id: String(entry?.id || ''),
      actor: String(entry?.actor || ''),
      isWebExtension: entry?.isWebExtension
    }))

    const match = (response?.addons || []).find(
      (entry) => String(entry?.id || '') === addonId
    )

    descriptorActor =
      typeof match?.actor === 'string' && match.actor ? match.actor : undefined
  } catch (error) {
    if (isAuthor) {
      console.log(
        messages.firefoxRdpReinjectListAddonsFailed(
          String((error as Error)?.message || error)
        )
      )
    }
    return undefined
  }

  if (!descriptorActor) {
    if (isAuthor) {
      console.log(
        messages.firefoxRdpReinjectNoDescriptor(
          addonId,
          JSON.stringify(listAddonsResponseSample)
        )
      )
    }
    return undefined
  }

  // Modern Firefox (post-Fission) doesn't expose getTarget on
  // webExtensionDescriptor — only [reload, terminateBackgroundScript,
  // reloadDescriptor, getWatcher]. Resolve the watcher and discover the
  // addon's frame target through its target-available-form stream.
  let watcherActor: string
  try {
    const watcherResponse = (await withTimeout(
      client.request({to: descriptorActor, type: 'getWatcher'}),
      RDP_REQUEST_TIMEOUT_MS,
      'getWatcher'
    )) as {actor?: string}
    if (typeof watcherResponse?.actor !== 'string' || !watcherResponse.actor) {
      if (isAuthor) {
        console.log(
          messages.firefoxRdpReinjectWatcherUnavailable(
            descriptorActor,
            'getWatcher returned no actor'
          )
        )
      }
      return undefined
    }
    watcherActor = watcherResponse.actor
  } catch (error) {
    if (isAuthor) {
      console.log(
        messages.firefoxRdpReinjectWatcherUnavailable(
          descriptorActor,
          String((error as Error)?.message || error)
        )
      )
    }
    return undefined
  }

  const captured: Array<{
    actor?: string
    consoleActor?: string
    url?: string
    targetType?: string
  }> = []
  const messageListener = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return
    const msg = raw as {
      type?: string
      from?: string
      target?: {
        actor?: string
        consoleActor?: string
        url?: string
        targetType?: string
      }
    }
    if (msg.from !== watcherActor) return
    if (msg.type !== 'target-available-form') return
    if (msg.target) captured.push(msg.target)
  }
  client.on('message', messageListener)

  try {
    await withTimeout(
      client.request({
        to: watcherActor,
        type: 'watchTargets',
        targetType: 'frame'
      }),
      RDP_REQUEST_TIMEOUT_MS,
      'watchTargets'
    )
    // The watchTargets response resolves once initial target-available-form
    // events have been emitted, but Firefox sometimes flushes them on the
    // following tick. Brief settle catches stragglers.
    await new Promise((resolve) => setTimeout(resolve, 200))
  } catch (error) {
    if (isAuthor) {
      console.log(
        messages.firefoxRdpReinjectWatchTargetsFailed(
          watcherActor,
          String((error as Error)?.message || error)
        )
      )
    }
    client.removeListener('message', messageListener)
    return undefined
  } finally {
    // Leave the listener attached briefly for late events, then detach to
    // avoid leaking listeners across rebuilds.
    setTimeout(() => {
      client.removeListener('message', messageListener)
    }, 1000)
  }

  if (isAuthor) {
    // eslint-disable-next-line no-console
    console.log(
      `[firefox-rt-reinject] watcher=${watcherActor} captured=${JSON.stringify(
        captured.map((entry) => ({
          url: entry.url,
          targetType: entry.targetType,
          actor: entry.actor ? '<actor>' : null,
          consoleActor: entry.consoleActor ? '<consoleActor>' : null
        }))
      )}`
    )
  }

  // The watcher is per-descriptor, so any frame-target it emits belongs to
  // this addon. Prefer the moz-extension:// frame (the addon background) over
  // any incidental about:blank entries.
  const addonFrame =
    captured.find(
      (entry) =>
        typeof entry.url === 'string' &&
        entry.url.startsWith('moz-extension://') &&
        !!entry.actor &&
        !!entry.consoleActor
    ) || captured.find((entry) => !!entry.actor && !!entry.consoleActor)

  if (!addonFrame || !addonFrame.actor || !addonFrame.consoleActor) {
    return undefined
  }

  return {
    consoleActor: String(addonFrame.consoleActor),
    targetActor: String(addonFrame.actor),
    addonId
  }
}
