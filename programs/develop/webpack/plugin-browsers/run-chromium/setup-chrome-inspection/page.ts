import * as messages from '../../browsers-lib/messages'
import {mergeShadowIntoDocument} from '../../browsers-lib/html-merge'
import type {CDPClient} from './cdp-client'

export async function getPageHTML(
  cdp: CDPClient,
  sessionId: string
): Promise<string> {
  try {
    const testResult = await cdp.evaluate(sessionId, 'document.title')
    if (typeof testResult !== 'string') {
      // Ignore, proceed; some sites guard document.title access
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

  let shadowContent: unknown = ''

  try {
    shadowContent = await cdp.evaluate(
      sessionId,
      `(() => {
          try {
            const host = document.querySelector('[data-extension-root="true"]')
            if (!host) return ''
            const sr = host.shadowRoot
            if (!sr) return ''
            return sr.innerHTML
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
  const deadline = Date.now() + 12000

  while (Date.now() < deadline) {
    try {
      const injected = await cdp.evaluate(
        sessionId,
        `(() => { try {
          const host = document.querySelector('[data-extension-root="true"]');
          if (!host) return false;
          const sr = host.shadowRoot; const html = sr ? String(sr.innerHTML||'') : '';
          if (html.length > 0) return true;
          if (html.includes('content_script')||html.includes('content_title')||html.includes('js-probe')) return true;
          return false;
        } catch { return false } })()`
      )
      if (Boolean(injected)) return
    } catch {
      // ignore
    }

    await new Promise((r) => setTimeout(r, 250))
  }
}
