// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import type {RdpSourceInspectionClient} from './rdp-types'
import {GET_PAGE_HTML_WITH_SHADOW_EXPRESSION} from './evaluate'

function normalizeInspectableUrl(rawUrl?: string): string {
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

export async function ensureTabForUrl(
  client: RdpSourceInspectionClient,
  urlToInspect?: string
): Promise<{actor: string; consoleActor?: string} | null> {
  const targets = await client.getTargets()
  const normalizedUrlToInspect = normalizeInspectableUrl(urlToInspect)
  let tab = (targets || []).find(
    (t) =>
      t && normalizeInspectableUrl(t.url) === normalizedUrlToInspect && t.actor
  )

  if (!tab) {
    tab =
      (targets || []).find((t) => t && (t.actor || t.outerWindowID)) ||
      (targets || [])[0]
  }

  if (!tab || !tab.actor) return null

  return {actor: tab.actor, consoleActor: tab.consoleActor}
}

export async function navigateTo(
  client: RdpSourceInspectionClient,
  tabActor: string,
  consoleActorHint: string | undefined,
  url: string
) {
  // Try consoleActor navigate script first, then native navigate
  try {
    const detail = await client.getTargetFromDescriptor(tabActor)
    const consoleActor =
      detail.consoleActor || consoleActorHint || tabActor
    const currentUrl = await client.evaluate(
      consoleActor,
      'String(location.href || "")'
    )
    const sameDocumentTarget =
      typeof currentUrl === 'string' &&
      normalizeInspectableUrl(currentUrl) === normalizeInspectableUrl(url)

    if (sameDocumentTarget) {
      let targetActor = tabActor
      if (detail.targetActor) {
        targetActor = String(detail.targetActor || targetActor)
      }
      try {
        await client.attach(targetActor)
      } catch {
        // Ignore
      }
      await client.navigate(targetActor, url)
      await client.waitForLoadEvent(targetActor)
      return
    }

    await client.navigateViaScript(consoleActor, url)
    await client.waitForPageReady(consoleActor, url, 8000)

    return
  } catch {
    // Ignore
  }

  let targetActor = tabActor
  try {
    const detail2 = await client.getTargetFromDescriptor(tabActor)
    if (detail2.targetActor)
      targetActor = String(detail2.targetActor || targetActor)
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
  client: RdpSourceInspectionClient,
  descriptorActor: string,
  consoleActorHint?: string
) {
  if (typeof client.getPageHTML === 'function') {
    return await client.getPageHTML(descriptorActor, consoleActorHint)
  }

  try {
    const titleResp = await client.evaluateRaw(
      descriptorActor,
      'String(document.title)'
    )
    await client.coerceResponseToString?.(descriptorActor, titleResp)
  } catch {
    // Ignore
  }

  let mainHTML = await client.serializeDocument?.(descriptorActor)
  if (!mainHTML) {
    const retry = await client.evaluateRaw(
      descriptorActor,
      'new XMLSerializer().serializeToString(document)'
    )
    try {
      mainHTML = await client.coerceResponseToString?.(descriptorActor, retry)
    } catch {
      mainHTML = ''
    }
    if (!mainHTML) return ''
  }

  const shadowContent = await client.extractShadowContent?.(descriptorActor)
  if (!shadowContent) return mainHTML

  try {
    const mergedResp = await client.evaluateRaw(
      descriptorActor,
      GET_PAGE_HTML_WITH_SHADOW_EXPRESSION
    )
    const mergedHtml = await client.coerceResponseToString?.(
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

  return client.mergeShadowIntoMain?.(mainHTML, shadowContent)
}

export async function resolveConsoleActorMethod(
  client: RdpSourceInspectionClient,
  tabActor: string,
  urlToInspect: string
) {
  const start = Date.now()
  const timeoutMs = 8000
  while (Date.now() - start < timeoutMs) {
    try {
      const targets = await client.getTargets()
      const byActor = targets.find((t) => t && t.actor === tabActor)
      const normalizedUrlToInspect = normalizeInspectableUrl(urlToInspect)
      const byUrl = targets.find(
        (t) => t && normalizeInspectableUrl(t.url) === normalizedUrlToInspect
      )
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
  client: RdpSourceInspectionClient,
  consoleActor: string
) {
  const deadline = Date.now() + 12000
  while (Date.now() < deadline) {
    try {
      const injected = await client.evaluate(
        consoleActor,
        `(() => {
            const root = document.querySelector('#extension-root,[data-extension-root]:not([data-extension-root="extension-js-devtools"])');
            if (!root || !root.shadowRoot) return false;
            const meaningfulChild = Array.from(root.shadowRoot.childNodes || []).some((node) => {
              if (!node) return false;
              if (node.nodeType === Node.TEXT_NODE) {
                return String(node.textContent || '').trim().length > 0;
              }
              if (node.nodeType !== Node.ELEMENT_NODE) return false;
              const element = node;
              const tagName = String(element.nodeName || '').toLowerCase();
              if (tagName === 'style') return false;
              const text = String(element.textContent || '').trim();
              return text.length > 0 || element.childElementCount > 0;
            });
            if (meaningfulChild) return true;
            const html = root.shadowRoot.innerHTML || '';
            return /<(?!style\\b)[a-z][^>]*>/i.test(html);
          })()`
      )
      if (injected) return true
    } catch {
      // Ignore
    }

    await new Promise((r) => setTimeout(r, 200))
  }

  return false
}
