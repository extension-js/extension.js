// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as messages from '../../browsers-lib/messages'
import {mergeShadowIntoDocument} from '../../browsers-lib/html-merge'
import type {CDPClient} from './cdp-client'

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

  // Attempt full page-context serialization with shadow content injected into a cloned document.
  // This avoids relying on sr.innerHTML visibility nuances.
  try {
    const mergedHtmlRaw = await cdp.evaluate(
      sessionId,
      `(() => { try { 
        var cloned = document.documentElement.cloneNode(true); 
        var host = cloned.querySelector('#extension-root,[data-extension-root="true"]'); 
        if (!host) { 
          var body = cloned.querySelector('body') || cloned; 
          var newRoot = document.createElement('div'); 
          newRoot.id='extension-root'; 
          body.appendChild(newRoot); 
          host = newRoot; 
        } 
        var s = new XMLSerializer(); 
        var shadow = ''; 
        try { 
          var liveHost = document.querySelector('[data-extension-root=\"true\"]') || document.getElementById('extension-root'); 
          if (liveHost && liveHost.shadowRoot) { 
            shadow = Array.from(liveHost.shadowRoot.childNodes).map(function(n){ 
              try { return s.serializeToString(n) } catch(e){ return '' } 
            }).join(''); 
          } 
        } catch(e) {} 
        try { host.innerHTML = shadow; } catch(e) {} 
        var doctype = document.doctype; 
        var dt = doctype ? '<!DOCTYPE ' + doctype.name + (doctype.publicId ? ' PUBLIC \"' + doctype.publicId + '\"' : '') + (doctype.systemId ? ' \"' + doctype.systemId + '\"' : '') + '>' : ''; 
        return String(dt + '\\n' + (cloned.outerHTML || document.documentElement.outerHTML)); 
      } catch(e) { try { return String(document.documentElement.outerHTML); } catch(_) { return '' } } })()`
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
    shadowContent = await cdp.evaluate(
      sessionId,
      `(() => {
          try {
            const hosts = Array.from(document.querySelectorAll('[data-extension-root="true"]'));
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
        })()`
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
): Promise<void> {
  const deadline = Date.now() + 30000
  const started = Date.now()

  while (Date.now() < deadline) {
    try {
      const injected = await cdp.evaluate(
        sessionId,
        `(() => { try {
          const hosts = Array.from(document.querySelectorAll('[data-extension-root="true"]'));
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
        } catch { return false } })()`
      )

      if (Boolean(injected)) return
    } catch {
      // ignore
    }

    const elapsed = Date.now() - started
    const delay = elapsed < 2000 ? 150 : 500

    await new Promise((r) => setTimeout(r, delay))
  }
}
