// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {mergeShadowIntoDocument} from '../../browsers-lib/html-merge'
import * as messages from '../../browsers-lib/messages'
import type {CDPClient} from './cdp-client'

const CONTENT_ROOT_SELECTOR =
  '#extension-root,[data-extension-root]:not([data-extension-root="extension-js-devtools"])'
const NON_DEVTOOLS_CONTENT_ROOT_SELECTOR =
  '#extension-root,[data-extension-root]:not([data-extension-root="extension-js-devtools"])'

/** Serialized snapshot of extension content roots / reinject markers (same shape as ChromiumSourceInspectionPlugin root meta). */
export type ExtensionRootMetaPayload = {
  rootCount: number
  markerCount: number
  latestGeneration: number
  roots: Array<{
    tag: string
    id?: string
    key?: string
    generation?: number
    status?: string
    build?: string
  }>
  markers: Array<{
    tag: string
    id?: string
    key?: string
    generation?: number
    status?: string
    build?: string
  }>
  registries: Array<{
    key: string
    generation?: number
    hasCleanup?: boolean
    build?: string
  }>
  page?: {
    key?: string
    generation?: number
    status?: string
    build?: string
  }
}

const EXTENSION_ROOT_META_EXPRESSION = `(() => {
          const readGeneration = (node) => {
            try {
              const raw = node && node.getAttribute
                ? node.getAttribute('data-extjs-reinject-generation')
                : '';
              const parsed = Number(raw);
              return Number.isFinite(parsed) ? parsed : undefined;
            } catch (error) {
              return undefined;
            }
          };
          const normalize = (node) => ({
            tag: node && node.tagName ? String(node.tagName).toLowerCase() : 'unknown',
            id: node && node.id ? String(node.id) : undefined,
            key: node && node.getAttribute ? node.getAttribute('data-extjs-reinject-key') || undefined : undefined,
            generation: readGeneration(node),
            status: node && node.getAttribute ? node.getAttribute('data-extjs-reinject-status') || undefined : undefined,
            build: node && node.getAttribute ? node.getAttribute('data-extjs-reinject-build') || undefined : undefined,
            hasShadowRoot: !!(node && node.shadowRoot),
            hasShadowContent: !!(node && node.shadowRoot && String(node.shadowRoot.innerHTML || '').trim())
          });
          const registry = (typeof globalThis === 'object' && globalThis)
            ? (globalThis.__EXTENSIONJS_DEV_REINJECT__ || {})
            : {};
          const registries = Object.entries(registry)
            .slice(0, 10)
            .map(([key, entry]) => {
              const candidate = entry && typeof entry === 'object' ? entry : {};
              const cleanup = candidate && typeof candidate.cleanup === 'function'
                ? candidate.cleanup
                : (typeof entry === 'function' ? entry : undefined);
              return {
                key,
                generation: typeof candidate.generation === 'number'
                  ? candidate.generation
                  : (cleanup && typeof cleanup.__extjsGeneration === 'number'
                    ? cleanup.__extjsGeneration
                    : undefined),
                hasCleanup: typeof cleanup === 'function',
                build: typeof candidate.build === 'string'
                  ? candidate.build
                  : (cleanup && typeof cleanup.__extjsBuild === 'string'
                    ? cleanup.__extjsBuild
                    : undefined)
              };
            });
          const pageCandidate = {
            key: document.documentElement.getAttribute('data-extjs-last-reinject-key') || undefined,
            generation: (() => {
              const parsed = Number(document.documentElement.getAttribute('data-extjs-last-reinject-generation') || '');
              return Number.isFinite(parsed) ? parsed : undefined;
            })(),
            status: document.documentElement.getAttribute('data-extjs-last-reinject-status') || undefined,
            build: document.documentElement.getAttribute('data-extjs-last-reinject-build') || undefined
          };
          const roots = Array.from(
            document.querySelectorAll('#extension-root,[data-extension-root]:not([data-extension-root="extension-js-devtools"])')
          )
            .slice(0, 10)
            .map(normalize)
            .filter((entry) =>
              entry.hasShadowRoot ||
              entry.hasShadowContent ||
              typeof entry.key === 'string' ||
              typeof entry.generation === 'number' ||
              typeof entry.status === 'string' ||
              typeof entry.build === 'string'
            )
            .map(({hasShadowRoot, hasShadowContent, ...entry}) => entry);
          const markers = Array.from(
            document.querySelectorAll('[data-extjs-reinject-marker="true"]')
          )
            .slice(0, 10)
            .map(normalize);
          const pageHasBackingEvidence =
            roots.length > 0 ||
            markers.length > 0 ||
            registries.some((entry) =>
              entry.key === pageCandidate.key ||
              typeof entry.generation === 'number' ||
              !!entry.hasCleanup ||
              typeof entry.build === 'string'
            );
          const page = pageHasBackingEvidence ? pageCandidate : undefined;
          const generations = roots
            .concat(markers)
            .map((entry) => entry.generation)
            .concat(typeof page.generation === 'number' ? [page.generation] : [])
            .concat(
              registries
                .map((entry) => entry.generation)
                .filter((value) => typeof value === 'number')
            )
            .filter((value) => typeof value === 'number');
          return {
            rootCount: roots.length,
            markerCount: markers.length,
            latestGeneration: generations.length ? Math.max(...generations) : 0,
            roots,
            markers,
            registries,
            page
          };
        })()`

const SHADOW_STYLE_SNAPSHOT_EXPRESSION = `(() => {
          try {
            const hosts = Array.from(document.querySelectorAll('#extension-root,[data-extension-root]:not([data-extension-root="extension-js-devtools"])'));
            if (!hosts.length) return null;
            for (const host of hosts) {
              const sr = host && host.shadowRoot;
              if (!sr) continue;
              const styles = Array.from(sr.querySelectorAll('style')).map((styleEl) => {
                const html = String(styleEl.outerHTML || '');
                const text = String(styleEl.textContent || '');
                return {
                  html,
                  textLength: text.length,
                  textSnippet: text.trim().slice(0, 200)
                };
              });
              return {
                rootMode: 'shadow',
                count: styles.length,
                styles
              };
            }
            return null;
          } catch {
            return null;
          }
        })()`

const HAS_VISIBLE_SHADOW_HOST_EXPRESSION = `(() => { try {
                const hosts = Array.from(document.querySelectorAll('#extension-root,[data-extension-root]:not([data-extension-root="extension-js-devtools"])'));
                if (!hosts.length) return false;
                for (const h of hosts) {
                  try {
                    const sr = h && h.shadowRoot;
                    if (sr && (String(sr.innerHTML||'').length > 0)) return true;
                  } catch { /* ignore */ }
                }
                return false;
              } catch { return false } })()`

async function collectExecutionContexts(
  cdp: CDPClient,
  sessionId: string
): Promise<any[]> {
  const rawCdp = cdp as unknown as {
    sendCommand?: (
      method: string,
      params?: Record<string, unknown>,
      sessionId?: string,
      timeoutMs?: number
    ) => Promise<unknown>
    onProtocolEvent?: (
      handler: (message: Record<string, unknown>) => void
    ) => () => void
  }

  if (
    typeof rawCdp.sendCommand !== 'function' ||
    typeof rawCdp.onProtocolEvent !== 'function'
  ) {
    return []
  }

  const contextsById = new Map<number, any>()
  const unsubscribe = rawCdp.onProtocolEvent((message) => {
    if (
      String((message as {sessionId?: string}).sessionId || '') !== sessionId
    ) {
      return
    }
    if (String(message.method || '') !== 'Runtime.executionContextCreated') {
      return
    }
    const context = (message as {params?: {context?: any}}).params?.context
    const contextId = context?.id
    if (typeof contextId === 'number') {
      contextsById.set(contextId, context)
    }
  })

  try {
    await rawCdp.sendCommand('Runtime.enable', {}, sessionId, 3000)
    await new Promise((resolve) => setTimeout(resolve, 100))
  } catch {
    return []
  } finally {
    unsubscribe()
  }

  return Array.from(contextsById.values())
}

async function getIsolatedContextId(
  cdp: CDPClient,
  sessionId: string
): Promise<number | undefined> {
  const contexts = await collectExecutionContexts(cdp, sessionId)
  const preferredContext = contexts.find((context) => {
    const auxData = context?.auxData || {}
    return (
      auxData.type === 'isolated' &&
      String(context?.origin || '').startsWith('chrome-extension://')
    )
  })
  if (typeof preferredContext?.id === 'number') {
    return preferredContext.id
  }

  const fallbackContext = contexts.find(
    (context) => context?.auxData?.type === 'isolated'
  )
  return typeof fallbackContext?.id === 'number'
    ? fallbackContext.id
    : undefined
}

export async function evaluateWithContentContext<T = unknown>(
  cdp: CDPClient,
  sessionId: string,
  expression: string,
  shouldAccept: (value: unknown) => boolean
): Promise<T | undefined> {
  let pageResult: unknown
  try {
    pageResult = await cdp.evaluate(sessionId, expression)
    if (shouldAccept(pageResult)) {
      return pageResult as T
    }
  } catch {
    // ignore and try the isolated content-script context next
  }

  try {
    const isolatedContextId = await getIsolatedContextId(cdp, sessionId)
    if (typeof isolatedContextId === 'number') {
      const isolatedResult = await cdp.evaluateInContext(
        sessionId,
        expression,
        isolatedContextId
      )
      if (shouldAccept(isolatedResult)) {
        return isolatedResult as T
      }
      if (typeof pageResult !== 'undefined') {
        return pageResult as T
      }
      return isolatedResult as T
    }
  } catch {
    // ignore and fall back to the page result
  }

  return pageResult as T | undefined
}

function isExtensionRootMetaPayload(
  value: unknown
): value is ExtensionRootMetaPayload {
  if (!value || typeof value !== 'object') return false
  const v = value as ExtensionRootMetaPayload
  return (
    typeof v.rootCount === 'number' &&
    typeof v.markerCount === 'number' &&
    typeof v.latestGeneration === 'number' &&
    Array.isArray(v.roots) &&
    Array.isArray(v.markers) &&
    Array.isArray(v.registries)
  )
}

export async function evaluateExtensionRootMeta(
  cdp: CDPClient,
  sessionId: string
): Promise<ExtensionRootMetaPayload | undefined> {
  try {
    const payload = await evaluateWithContentContext<ExtensionRootMetaPayload>(
      cdp,
      sessionId,
      EXTENSION_ROOT_META_EXPRESSION,
      isExtensionRootMetaPayload
    )
    return payload
  } catch {
    return undefined
  }
}

export async function evaluateShadowStyleSnapshot(
  cdp: CDPClient,
  sessionId: string
): Promise<Record<string, unknown> | undefined> {
  try {
    const payload = await evaluateWithContentContext<Record<
      string,
      unknown
    > | null>(
      cdp,
      sessionId,
      SHADOW_STYLE_SNAPSHOT_EXPRESSION,
      (value) => value === null || (typeof value === 'object' && value !== null)
    )
    if (payload === null || payload === undefined) return undefined
    return payload
  } catch {
    return undefined
  }
}

/** Used after navigation when injection wait timed out — polls with isolated-world fallback. */
export async function pollForVisibleShadowHostContent(
  cdp: CDPClient,
  sessionId: string,
  deadlineMs = 4000
): Promise<void> {
  const deadline = Date.now() + deadlineMs
  const started = Date.now()
  while (Date.now() < deadline) {
    try {
      const hasRoot = await hasVisibleShadowHostContent(cdp, sessionId)
      if (hasRoot) return
    } catch {
      // ignore
    }
    const elapsed = Date.now() - started
    const delay = elapsed < 1000 ? 150 : 350
    await new Promise((r) => setTimeout(r, delay))
  }
}

/** Single-shot check aligned with waitForContentScriptInjection shadow proof. */
export async function hasVisibleShadowHostContent(
  cdp: CDPClient,
  sessionId: string
): Promise<boolean> {
  try {
    const v = await evaluateWithContentContext<boolean>(
      cdp,
      sessionId,
      HAS_VISIBLE_SHADOW_HOST_EXPRESSION,
      (value) => value === true || value === false
    )
    return v === true
  } catch {
    return false
  }
}

export async function getPageHTML(
  cdp: CDPClient,
  sessionId: string,
  includeShadow: 'off' | 'open-only' | 'all' = 'open-only'
): Promise<string> {
  try {
    const testResult = await cdp.evaluate(sessionId, 'document.title')
    if (typeof testResult !== 'string') {
      // Ignore, proceed. Some sites guard document.title access
    }
  } catch {
    // ignore
  }

  const mainHTMLRaw = await cdp.evaluate(
    sessionId,
    `(() => {
        try {
          const serialize = () => {
            const doctype = document.doctype  
            const dt = doctype
              ? '<!DOCTYPE '
                + doctype.name
                + (doctype.publicId ? ' PUBLIC "' + doctype.publicId + '"' : '')
                + (doctype.systemId ? ' "' + doctype.systemId + '"' : '')
                + '>'
              : ''
            return dt + '\n' + document.documentElement.outerHTML
          }
          return serialize()
        } catch (e) {
          return ''
        }
      })()`
  )
  const mainHTML =
    typeof mainHTMLRaw === 'string' ? mainHTMLRaw : String(mainHTMLRaw || '')

  if (includeShadow === 'off') {
    return mainHTML
  }

  const hasVisibleContentRoot = await evaluateWithContentContext<boolean>(
    cdp,
    sessionId,
    `(() => {
      try {
        return !!document.querySelector(${JSON.stringify(
          NON_DEVTOOLS_CONTENT_ROOT_SELECTOR
        )})
      } catch {
        return false
      }
    })()`,
    (value) => typeof value === 'boolean'
  )

  if (!hasVisibleContentRoot) {
    return mainHTML
  }

  // Attempt full page-context serialization with shadow content injected into a cloned document.
  // This avoids relying on sr.innerHTML visibility nuances.
  try {
    const mergedHtmlRaw = await evaluateWithContentContext<string>(
      cdp,
      sessionId,
      `(() => { try { 
        var cloned = document.documentElement.cloneNode(true); 
        var selector = ${JSON.stringify(NON_DEVTOOLS_CONTENT_ROOT_SELECTOR)};
        var s = new XMLSerializer(); 
        try { 
          var liveHosts = Array.from(document.querySelectorAll(selector));
          if (!liveHosts.length) return '';
          var clonedHosts = Array.from(cloned.querySelectorAll(selector));
          if (clonedHosts.length < liveHosts.length) {
            var cloneDoc = cloned.ownerDocument || document;
            var cloneBody = cloned.querySelector('body') || cloned;
            for (var missingIndex = clonedHosts.length; missingIndex < liveHosts.length; missingIndex++) {
              var missingLiveHost = liveHosts[missingIndex];
              if (!missingLiveHost || !missingLiveHost.tagName || !cloneBody || typeof cloneBody.appendChild !== 'function') continue;
              var shell = cloneDoc.createElement(String(missingLiveHost.tagName || 'div').toLowerCase());
              try {
                Array.from(missingLiveHost.attributes || []).forEach(function(attr){
                  try { shell.setAttribute(attr.name, attr.value); } catch(_) {}
                });
              } catch(_) {}
              try { cloneBody.appendChild(shell); } catch(_) {}
              clonedHosts.push(shell);
            }
          }
          for (var index = 0; index < liveHosts.length; index++) {
            var host = clonedHosts[index];
            var liveHost = liveHosts[index];
            if (!host || !liveHost || !liveHost.shadowRoot) continue;
            var shadow = Array.from(liveHost.shadowRoot.childNodes).map(function(n){ 
              try { return s.serializeToString(n) } catch(e){ return '' } 
            }).join('');
            if (!shadow) continue;
            try { host.innerHTML = shadow; } catch(e) {}
          } 
        } catch(e) {} 
        var doctype = document.doctype; 
        var dt = doctype ? '<!DOCTYPE ' + doctype.name + (doctype.publicId ? ' PUBLIC \"' + doctype.publicId + '\"' : '') + (doctype.systemId ? ' \"' + doctype.systemId + '\"' : '') + '>' : ''; 
        return String(dt + '\\n' + (cloned.outerHTML || document.documentElement.outerHTML)); 
      } catch(e) { try { return String(document.documentElement.outerHTML); } catch(_) { return '' } } })()`,
      (value) => typeof value === 'string' && /<html[\s>]/i.test(value)
    )
    const mergedHtml =
      typeof mergedHtmlRaw === 'string'
        ? mergedHtmlRaw
        : String(mergedHtmlRaw || '')
    if (mergedHtml && /<html[\s>]/i.test(mergedHtml)) {
      return mergedHtml
    }
  } catch {
    // ignore best-effort page-side merge
  }

  let shadowContent: unknown = ''

  try {
    shadowContent = await evaluateWithContentContext(
      cdp,
      sessionId,
      `(() => {
          try {
            const hosts = Array.from(document.querySelectorAll(${JSON.stringify(
              CONTENT_ROOT_SELECTOR
            )}));
            if (!hosts.length) return '';
            const preferMarkers = ['iskilar_box','content_script','content_title','js-probe'];
            let firstNonEmpty = '';
            for (const host of hosts) {
              try {
                const sr = host && host.shadowRoot;
                if (!sr) continue;
                const html = String(sr.innerHTML || '');
                if (html && html.length) {
                  if (preferMarkers.some((m) => html.includes(m))) return html;
                  if (!firstNonEmpty) firstNonEmpty = html;
                  continue;
                }
                try {
                  const parts = Array.from(sr.children)
                    .map((n) => (n && n.outerHTML) ? String(n.outerHTML) : '')
                    .join('');
                  if (parts && parts.length) {
                    if (preferMarkers.some((m) => parts.includes(m))) return parts;
                    if (!firstNonEmpty) firstNonEmpty = parts;
                  }
                } catch { /* ignore */ }
              } catch { /* ignore */ }
            }
            return firstNonEmpty || '';
          } catch { return '' }
        })()`,
      (value) => typeof value === 'string' && value.trim().length > 0
    )
  } catch {
    // ignore
  }

  if (shadowContent) {
    try {
      const sc =
        typeof shadowContent === 'string'
          ? shadowContent
          : String(shadowContent || '')
      return mergeShadowIntoDocument(mainHTML, sc)
    } catch {
      // ignore
    }
  }

  return mainHTML
}

export async function waitForLoadEvent(
  cdp: CDPClient,
  sessionId: string
): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false

    const listener = (data: string) => {
      try {
        const message = JSON.parse(data) as {
          method?: string
          sessionId?: string
        }
        if (
          message.method === 'Page.loadEventFired' &&
          message.sessionId === sessionId &&
          !resolved
        ) {
          resolved = true
          resolve()
        }
      } catch {
        // ignore
      }
    }

    const clientWithHandle = cdp as unknown as {
      handleMessage: (data: string) => void
    }
    const original = clientWithHandle.handleMessage.bind(cdp)

    clientWithHandle.handleMessage = (data: string) => {
      original(data)
      listener(data)
    }

    setTimeout(() => {
      if (!resolved) {
        resolved = true
        console.log(messages.cdpClientLoadEventTimeout())
        resolve()
      }

      clientWithHandle.handleMessage = original
    }, 2000)
  })
}

export async function waitForContentScriptInjection(
  cdp: CDPClient,
  sessionId: string
): Promise<boolean> {
  const deadline = Date.now() + 30000
  const started = Date.now()

  while (Date.now() < deadline) {
    try {
      const injected = await evaluateWithContentContext<boolean>(
        cdp,
        sessionId,
        `(() => { try {
          const hosts = Array.from(document.querySelectorAll(${JSON.stringify(
            CONTENT_ROOT_SELECTOR
          )}));
          if (!hosts.length) return false;
          const markers = ['iskilar_box','content_script','content_title','js-probe'];
          for (const h of hosts) {
            try {
              const sr = h && h.shadowRoot;
              if (!sr) continue;
              const html = String(sr.innerHTML||'');
              if (html.length > 0) return true;
              if (markers.some((m) => html.includes(m))) return true;
              try {
                const parts = Array.from(sr.children).map((n) => (n && n.outerHTML) ? String(n.outerHTML) : '').join('');
                if (parts && parts.length) return true;
                if (markers.some((m) => parts.includes(m))) return true;
              } catch { /* ignore */ }
            } catch { /* ignore */ }
          }
          return false;
        } catch { return false } })()`,
        (value) => Boolean(value)
      )

      if (Boolean(injected)) return true
    } catch {
      // ignore
    }

    const elapsed = Date.now() - started
    const delay = elapsed < 2000 ? 150 : 500

    await new Promise((r) => setTimeout(r, delay))
  }

  return false
}
