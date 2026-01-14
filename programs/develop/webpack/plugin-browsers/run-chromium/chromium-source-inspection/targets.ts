// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as messages from '../../browsers-lib/messages'
import {CDPClient} from './cdp-client'

export async function ensureTargetAndSession(
  cdpClient: CDPClient,
  url: string
): Promise<{targetId: string; sessionId: string}> {
  const targets = (await cdpClient.getTargets()) as Array<{
    url?: string
    type?: string
    targetId?: string
  }>
  const existingTarget = (targets || []).find(
    (t) => String(t?.url || '') === url && String(t?.type || '') === 'page'
  )

  let targetId: string = ''

  if (existingTarget && existingTarget.targetId) {
    targetId = String(existingTarget.targetId)

    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(
        messages.sourceInspectorUsingExistingTarget(existingTarget.targetId)
      )
    }
  } else {
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(messages.sourceInspectorCreatingTarget())
    }

    const created = await cdpClient.createTarget(url)
    targetId = String(created)

    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(messages.sourceInspectorTargetCreated(targetId))
      console.log(messages.sourceInspectorEnsuringNavigation())
    }

    // Attach then navigate via session
    const tempSession = await cdpClient.attachToTarget(targetId)
    if (tempSession) {
      // Enable Runtime/Log early to avoid missing initial console logs
      try {
        await cdpClient.enableRuntimeAndLog(String(tempSession))
      } catch {
        // ignore
      }

      await cdpClient.navigate(String(tempSession), url)
    }
  }

  if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
    console.log(messages.sourceInspectorAttachingToTarget())
  }

  const sessionId = String((await cdpClient.attachToTarget(targetId)) || '')

  if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
    console.log(messages.sourceInspectorAttachedToTarget(sessionId))
    console.log(messages.sourceInspectorEnablingPageDomain())
  }

  await cdpClient.sendCommand('Page.enable', {}, sessionId)

  // Ensure Runtime/Log are enabled on the final session as well
  try {
    await cdpClient.enableRuntimeAndLog(sessionId)
  } catch {
    // ignore
  }

  return {targetId: String(targetId), sessionId: String(sessionId)}
}
