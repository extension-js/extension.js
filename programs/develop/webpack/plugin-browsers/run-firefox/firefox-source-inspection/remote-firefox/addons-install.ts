import {Compilation} from '@rspack/core'
import * as messages from '../../../browsers-lib/messages'
import {resolveAddonDirectory} from './addons'
import {MessagingClient} from './messaging-client'

export async function getAddonsActorWithRetry(
  client: MessagingClient,
  cached: string | undefined,
  tries = 40,
  delayMs = 250
): Promise<string | undefined> {
  if (cached) return cached
  let addonsActor: string | undefined

  for (let i = 0; i < tries && !addonsActor; i++) {
    try {
      const root = (await client.request('getRoot')) as {addonsActor?: string}
      if (root && root.addonsActor) {
        addonsActor = root.addonsActor
        break
      }
    } catch {
      // Ignore
    }

    if (!addonsActor) {
      try {
        const tabs = (await client.request('listTabs')) as {
          addonsActor?: string
        }
        if (tabs && tabs.addonsActor) {
          addonsActor = tabs.addonsActor
          break
        }
      } catch {
        // Ignore
      }
    }

    if (!addonsActor) await new Promise((r) => setTimeout(r, delayMs))
  }

  return addonsActor
}

export function computeCandidateAddonPaths(
  compilation: Compilation,
  extensionsToLoad: string[],
  projectContext?: string
): string[] {
  const projectPath =
    compilation.options.context || projectContext || process.cwd()

  return extensionsToLoad.map((ext) => resolveAddonDirectory(projectPath, ext))
}

export async function waitForManagerWelcome(
  client: MessagingClient
): Promise<void> {
  for (let i = 0; i < 20; i++) {
    try {
      const tabs = (await client.request('listTabs')) as {
        tabs?: Array<{url?: string}>
      }
      const hasWelcome = Array.isArray(tabs?.tabs)
        ? tabs.tabs.some(
            (t) =>
              typeof t?.url === 'string' &&
              (t.url.includes('welcome.html') || t.url.includes('about:home'))
          )
        : false

      if (hasWelcome) return
    } catch {
      // Ignore
    }

    await new Promise((r) => setTimeout(r, 200))
  }
}

export async function installTemporaryAddon(
  client: MessagingClient,
  addonsActor: string,
  addonPath: string,
  openDevTools: boolean
): Promise<{addon?: {id?: string}} | undefined> {
  if (!addonsActor) {
    throw new Error(
      messages.addonInstallError(
        'firefox',
        'No addonsActor available from Firefox RDP.'
      )
    )
  }

  const clientResponse = await client.request({
    to: addonsActor,
    type: 'installTemporaryAddon',
    addonPath,
    openDevTools
  })

  return clientResponse as {addon?: {id?: string}} | undefined
}
