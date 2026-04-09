// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as messages from '../../../browsers-lib/messages'
import {MessagingClient} from './messaging-client'

const PAGE_READY_TIMEOUT_MS = 8000

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

export async function ensureNavigatedAndLoaded(
  client: MessagingClient,
  urlToInspect: string,
  tabActor: string
): Promise<void> {
  if (!tabActor) {
    throw new Error(messages.sourceInspectorNoTabActorAvailable())
  }

  // Resolve real target/console actors and attach to frame first
  let consoleActor = tabActor
  let frameActor = tabActor

  try {
    const detail = await client.getTargetFromDescriptor(tabActor)
    if (detail.consoleActor) consoleActor = detail.consoleActor
    if (detail.targetActor) frameActor = detail.targetActor
  } catch (error) {
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      const err = error as Error
      console.warn(
        '[RDP] getTargetFromDescriptor failed:',
        String(err.message || err)
      )
    }
  }

  try {
    await client.attach(frameActor)
  } catch (error) {
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      const err = error as Error
      console.warn(
        '[RDP] attach(frameActor) failed:',
        String(err.message || err)
      )
    }
  }

  try {
    const currentUrl = await client.evaluate(
      consoleActor,
      'String(location.href || "")'
    )
    const sameDocumentTarget =
      typeof currentUrl === 'string' &&
      normalizeInspectableUrl(currentUrl) ===
        normalizeInspectableUrl(urlToInspect)

    if (sameDocumentTarget) {
      if (
        process.env.EXTENSION_AUTHOR_MODE === 'true' ||
        process.env.EXTENSION_DEBUG_FIREFOX_INSPECTION === '1'
      ) {
        console.log(`[RDP] forcing native same-url reload for ${urlToInspect}`)
      }

      const detail = await client.getTargetFromDescriptor(tabActor)
      const targetActor = detail.targetActor || frameActor || tabActor

      try {
        await client.attach(targetActor)
      } catch (error) {
        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          const err = error as Error
          console.warn(
            '[RDP] attach(targetActor for same-url reload) failed:',
            String(err.message || err)
          )
        }
      }

      await client.navigate(targetActor, urlToInspect)
      await client.waitForLoadEvent(targetActor)
      return
    }
  } catch (error) {
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      const err = error as Error
      console.warn(
        '[RDP] current URL check before navigate failed:',
        String(err.message || err)
      )
    }
  }

  try {
    await client.navigateViaScript(consoleActor, urlToInspect)
    await client.waitForPageReady(
      consoleActor,
      urlToInspect,
      PAGE_READY_TIMEOUT_MS
    )
    return
  } catch (error) {
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      const err = error as Error
      console.warn(
        '[RDP] navigateViaScript/waitForPageReady failed:',
        String(err.message || err)
      )
    }
  }

  // Fallback to native navigate when available
  try {
    const detail = await client.getTargetFromDescriptor(tabActor)
    const targetActor = detail.targetActor || tabActor

    try {
      await client.attach(targetActor)
    } catch (error) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        const err = error as Error
        console.warn(
          '[RDP] attach(targetActor) failed:',
          String(err.message || err)
        )
      }
    }

    await client.navigate(targetActor, urlToInspect)
    await client.waitForLoadEvent(targetActor)
  } catch (error) {
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      const err = error as Error
      console.warn(
        '[RDP] fallback navigate/waitForLoadEvent failed:',
        String(err.message || err)
      )
    }
  }
}
