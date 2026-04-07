// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {MessagingClient} from './messaging-client'

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
  client: MessagingClient,
  urlToInspect?: string
): Promise<{actor: string; consoleActor?: string} | null> {
  const targets = (await client.getTargets()) as Array<{
    url?: string
    actor?: string
    outerWindowID?: unknown
    consoleActor?: string
  }>
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
    const currentUrl = await client.evaluate(
      consoleActor,
      'String(location.href || "")'
    )
    const sameDocumentTarget =
      typeof currentUrl === 'string' &&
      normalizeInspectableUrl(currentUrl) === normalizeInspectableUrl(url)

    if (sameDocumentTarget) {
      let targetActor = tabActor
      if ((detail as unknown as {targetActor?: string}).targetActor) {
        targetActor = String(
          (detail as unknown as {targetActor?: string}).targetActor ||
            targetActor
        )
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
  if (typeof (client as any).getPageHTML === 'function') {
    return await (client as any).getPageHTML(descriptorActor, consoleActorHint)
  }

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
  // #region agent log
  fetch('http://127.0.0.1:7795/ingest/9eb8f923-a325-4455-a46c-a6e706558307', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': 'a87efc'
    },
    body: JSON.stringify({
      sessionId: 'a87efc',
      runId: process.env.EXTENSION_INSTANCE_ID || 'firefox-source-inspection',
      hypothesisId: 'H3',
      location: 'remote-firefox/source-inspect.ts:getPageHTML',
      message: 'Firefox page HTML extraction snapshot',
      data: {
        descriptorActor,
        consoleActorHint,
        mainHtmlLength: typeof mainHTML === 'string' ? mainHTML.length : 0,
        shadowContentLength:
          typeof shadowContent === 'string' ? shadowContent.length : 0,
        mainHasRoot:
          typeof mainHTML === 'string' &&
          /#extension-root|data-extension-root/i.test(mainHTML),
        shadowHasContentMarkers:
          typeof shadowContent === 'string' &&
          /content_script|content_title|js-probe|iskilar_box/i.test(
            shadowContent
          )
      },
      timestamp: Date.now()
    })
  }).catch(() => {})
  // #endregion
  if (!shadowContent) return mainHTML

  try {
    const mergedResp = await client.evaluateRaw(
      descriptorActor,
      `(() => { try { var selector = '#extension-root,[data-extension-root]:not([data-extension-root="extension-js-devtools"])'; var serializeShadowRoot = function(shadowRoot, serializer) { if (!shadowRoot) return ''; var stylesheetCss = Array.from(shadowRoot.styleSheets || []).map(function(sheet) { try { return Array.from(sheet.cssRules || []).map(function(rule) { return String(rule.cssText || ''); }).join('\\n'); } catch (e) { return ''; } }).filter(Boolean).join('\\n'); var adoptedCss = Array.from(shadowRoot.adoptedStyleSheets || []).map(function(sheet) { try { return Array.from(sheet.cssRules || []).map(function(rule) { return String(rule.cssText || ''); }).join('\\n'); } catch (e) { return ''; } }).filter(Boolean).join('\\n'); var stylesheetMarkup = stylesheetCss ? '<style>' + stylesheetCss + '</style>' : ''; var adoptedMarkup = adoptedCss ? '<style>' + adoptedCss + '</style>' : ''; var childMarkup = Array.from(shadowRoot.childNodes || []).map(function(node) { try { if (node && node.nodeType === 1 && String(node.nodeName || '').toLowerCase() === 'style') { return '<style>' + String(node.textContent || '') + '</style>'; } return serializer.serializeToString(node); } catch (e) { return ''; } }).join(''); return stylesheetMarkup + adoptedMarkup + childMarkup; }; var cloned = document.documentElement.cloneNode(true); var clonedHosts = Array.from(cloned.querySelectorAll(selector)); var liveHosts = Array.from(document.querySelectorAll(selector)); if (!clonedHosts.length) { var body = cloned.querySelector('body') || cloned; var newRoot = document.createElement('div'); newRoot.id='extension-root'; body.appendChild(newRoot); clonedHosts = [newRoot]; } var s = new XMLSerializer(); for (var i = 0; i < clonedHosts.length; i++) { var host = clonedHosts[i]; var live = liveHosts[i]; var shadow = ''; try { if (live && live.shadowRoot) { shadow = serializeShadowRoot(live.shadowRoot, s); } } catch (e) {} try { host.innerHTML = shadow; } catch (e) {} } return String('<!DOCTYPE html>' + (cloned.outerHTML || document.documentElement.outerHTML)); } catch(e) { try { return String(document.documentElement.outerHTML); } catch(_) { return '' } } })()`
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
  client: MessagingClient,
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
      if (injected) {
        try {
          const snapshot = await client.evaluate(
            consoleActor,
            `(() => {
              try {
                const hosts = Array.from(document.querySelectorAll('#extension-root,[data-extension-root]:not([data-extension-root="extension-js-devtools"])'));
                return JSON.stringify({
                  readyState: document.readyState,
                  hostCount: hosts.length,
                  hosts: hosts.slice(0, 6).map((host, index) => {
                    const shadow = host && host.shadowRoot;
                    const html = shadow ? String(shadow.innerHTML || '') : '';
                    const meaningfulChild = shadow ? Array.from(shadow.childNodes || []).some((node) => {
                      try {
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
                      } catch {
                        return false;
                      }
                    }) : false;
                    return {
                      index,
                      id: host && host.id ? String(host.id) : '',
                      rootAttr: host && host.getAttribute ? String(host.getAttribute('data-extension-root') || '') : '',
                      hasShadow: !!shadow,
                      shadowChildCount: shadow ? shadow.childNodes.length : 0,
                      shadowElementCount: shadow ? shadow.querySelectorAll('*').length : 0,
                      meaningfulChild,
                      shadowHtmlSnippet: html.slice(0, 200)
                    };
                  })
                });
              } catch (error) {
                return JSON.stringify({error: String(error && error.message || error)});
              }
            })()`
          )
          // #region agent log
          fetch(
            'http://127.0.0.1:7795/ingest/9eb8f923-a325-4455-a46c-a6e706558307',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Debug-Session-Id': 'a87efc'
              },
              body: JSON.stringify({
                sessionId: 'a87efc',
                runId:
                  process.env.EXTENSION_INSTANCE_ID ||
                  'firefox-source-inspection',
                hypothesisId: 'H2',
                location:
                  'remote-firefox/source-inspect.ts:waitForContentScriptInjectionMethod:success',
                message: 'Firefox injection waiter succeeded',
                data: {consoleActor, snapshot},
                timestamp: Date.now()
              })
            }
          ).catch(() => {})
          // #endregion
        } catch {
          // Ignore debug probe failures.
        }
        return true
      }
    } catch {
      // Ignore
    }

    await new Promise((r) => setTimeout(r, 200))
  }

  try {
    const snapshot = await client.evaluate(
      consoleActor,
      `(() => {
        try {
          const hosts = Array.from(document.querySelectorAll('#extension-root,[data-extension-root]:not([data-extension-root="extension-js-devtools"])'));
          const selected = document.querySelector('#extension-root,[data-extension-root]:not([data-extension-root="extension-js-devtools"])');
          const selectedShadow = selected && selected.shadowRoot;
          return JSON.stringify({
            readyState: document.readyState,
            href: String(location.href || ''),
            title: String(document.title || ''),
            hostCount: hosts.length,
            selectedHost: selected ? {
              id: selected.id ? String(selected.id) : '',
              rootAttr: selected.getAttribute ? String(selected.getAttribute('data-extension-root') || '') : '',
              hasShadow: !!selectedShadow,
              shadowHtmlSnippet: selectedShadow ? String(selectedShadow.innerHTML || '').slice(0, 200) : ''
            } : null,
            hosts: hosts.slice(0, 6).map((host, index) => {
              const shadow = host && host.shadowRoot;
              const html = shadow ? String(shadow.innerHTML || '') : '';
              const meaningfulChild = shadow ? Array.from(shadow.childNodes || []).some((node) => {
                try {
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
                } catch {
                  return false;
                }
              }) : false;
              return {
                index,
                id: host && host.id ? String(host.id) : '',
                rootAttr: host && host.getAttribute ? String(host.getAttribute('data-extension-root') || '') : '',
                hasShadow: !!shadow,
                shadowChildCount: shadow ? shadow.childNodes.length : 0,
                shadowElementCount: shadow ? shadow.querySelectorAll('*').length : 0,
                meaningfulChild,
                shadowHtmlSnippet: html.slice(0, 200)
              };
            })
          });
        } catch (error) {
          return JSON.stringify({error: String(error && error.message || error)});
        }
      })()`
    )
    // #region agent log
    fetch('http://127.0.0.1:7795/ingest/9eb8f923-a325-4455-a46c-a6e706558307', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': 'a87efc'
      },
      body: JSON.stringify({
        sessionId: 'a87efc',
        runId: process.env.EXTENSION_INSTANCE_ID || 'firefox-source-inspection',
        hypothesisId: 'H2',
        location:
          'remote-firefox/source-inspect.ts:waitForContentScriptInjectionMethod:timeout',
        message: 'Firefox injection waiter timed out',
        data: {consoleActor, snapshot},
        timestamp: Date.now()
      })
    }).catch(() => {})
    // #endregion
  } catch {
    // Ignore debug probe failures.
  }

  return false
}
