// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {MessagingClient} from './messaging-client'

export async function ensureTabForUrl(
  client: MessagingClient,
  urlToInspect?: string
): Promise<{actor: string; consoleActor?: string} | null> {
  const targets = (await client.getTargets()) as Array<{
    url?: string
    actor?: string
    outerWindowID?: unknown
    consoleActor?: string
  }>
  let tab = (targets || []).find((t) => t && t.url === urlToInspect && t.actor)

  if (!tab) {
    tab =
      (targets || []).find((t) => t && (t.actor || t.outerWindowID)) ||
      (targets || [])[0]
  }

  if (!tab || !tab.actor) return null

  return {actor: tab.actor, consoleActor: tab.consoleActor}
}

export async function navigateTo(
  client: MessagingClient,
  tabActor: string,
  consoleActorHint: string | undefined,
  url: string
) {
  // Try consoleActor navigate script first, then native navigate
  try {
    const detail = await client.getTargetFromDescriptor(tabActor)
    const consoleActor =
      (detail as unknown as {consoleActor?: string}).consoleActor ||
      consoleActorHint ||
      tabActor
    await client.navigateViaScript(consoleActor, url)
    await client.waitForPageReady(consoleActor, url, 8000)

    return
  } catch {
    // Ignore
  }

  let targetActor = tabActor
  try {
    const detail2 = await client.getTargetFromDescriptor(tabActor)
    if ((detail2 as unknown as {targetActor?: string}).targetActor)
      targetActor = String(
        (detail2 as unknown as {targetActor?: string}).targetActor ||
          targetActor
      )
  } catch {
    // Ignore
  }
  try {
    await client.attach(targetActor)
  } catch {
    // Ignore
  }
  await client.navigate(targetActor, url)
  await client.waitForLoadEvent(targetActor)
}

// Extract full page HTML including shadow DOM
export async function getPageHTML(
  client: MessagingClient,
  descriptorActor: string,
  consoleActorHint?: string
) {
  try {
    const titleResp = await client.evaluateRaw(
      descriptorActor,
      'String(document.title)'
    )
    await (client as any).coerceResponseToString?.(descriptorActor, titleResp)
  } catch {
    // Ignore
  }

  let mainHTML = await (client as any).serializeDocument?.(descriptorActor)
  if (!mainHTML) {
    const retry = await client.evaluateRaw(
      descriptorActor,
      'new XMLSerializer().serializeToString(document)'
    )
    try {
      mainHTML = await (client as any).coerceResponseToString?.(
        descriptorActor,
        retry
      )
    } catch {
      mainHTML = ''
    }
    if (!mainHTML) return ''
  }

  const shadowContent = await (client as any).extractShadowContent?.(
    descriptorActor
  )
  if (!shadowContent) return mainHTML

  try {
    const mergedResp = await client.evaluateRaw(
      descriptorActor,
      `(() => { try { var cloned = document.documentElement.cloneNode(true); var host = cloned.querySelector('#extension-root'); if (!host) { var body = cloned.querySelector('body') || cloned; var newRoot = document.createElement('div'); newRoot.id='extension-root'; body.appendChild(newRoot); host = newRoot; } var s = new XMLSerializer(); var shadow = ''; try { var live = document.getElementById('extension-root'); if (live && live.shadowRoot) { shadow = Array.from(live.shadowRoot.childNodes).map(function(n){ try { return s.serializeToString(n) } catch(e){ return '' } }).join(''); } } catch(e) {} try { host.innerHTML = shadow; } catch(e) {} return String('<!DOCTYPE html>' + (cloned.outerHTML || document.documentElement.outerHTML)); } catch(e) { try { return String(document.documentElement.outerHTML); } catch(_) { return '' } } })()`
    )
    const mergedHtml = await (client as any).coerceResponseToString?.(
      descriptorActor,
      mergedResp,
      {fallbackToFullDocument: false}
    )
    if (typeof mergedHtml === 'string' && /<html[\s>]/i.test(mergedHtml)) {
      return mergedHtml
    }
  } catch {
    // Ignore
  }

  return (client as any).mergeShadowIntoMain?.(mainHTML, shadowContent)
}

export async function resolveConsoleActorMethod(
  client: MessagingClient,
  tabActor: string,
  urlToInspect: string
) {
  const start = Date.now()
  const timeoutMs = 8000
  while (Date.now() - start < timeoutMs) {
    try {
      const targets = (await client.getTargets()) as any[]
      const byActor = targets.find((t) => t && t.actor === tabActor)
      const byUrl = targets.find((t) => t && t.url === urlToInspect)
      const match = byActor || byUrl
      const consoleActor = match?.consoleActor || match?.webConsoleActor

      if (typeof consoleActor === 'string' && consoleActor.length > 0)
        return consoleActor

      try {
        const detail = await client.getTargetFromDescriptor(tabActor)
        const guessed = detail.consoleActor
        if (typeof guessed === 'string' && guessed.length > 0) return guessed
      } catch {
        // Ignore
      }
    } catch {
      // Ignore
    }

    await new Promise((r) => setTimeout(r, 200))
  }

  return tabActor
}

export async function waitForContentScriptInjectionMethod(
  client: MessagingClient,
  consoleActor: string
) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    try {
      const injected = await client.evaluate(
        consoleActor,
        `(() => {
            const root = document.getElementById('extension-root');
            if (!root || !root.shadowRoot) return false;
            const html = root.shadowRoot.innerHTML || '';
            return html.length > 0;
          })()`
      )
      if (injected) return
    } catch {
      // Ignore
    }

    await new Promise((r) => setTimeout(r, 200))
  }
}
