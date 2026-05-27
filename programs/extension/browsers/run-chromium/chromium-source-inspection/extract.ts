// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as messages from '../../browsers-lib/messages'
import {CDPClient} from './cdp-client'

const CONTENT_HTML_HINT_RE =
  /(id=\"extension-root\"|data-extension-root=|content_script|content_title|js-probe|data-extjs-last-reinject-status=\"mounted\"|data-extjs-reinject-marker=)/i

export async function extractPageHtml(
  cdpClient: CDPClient,
  sessionId: string,
  logSamples = process.env.EXTENSION_AUTHOR_MODE === 'true',
  includeShadow: 'off' | 'open-only' | 'all' = 'open-only'
): Promise<string> {
  let html = await cdpClient.getPageHTML(sessionId, includeShadow)

  if (!html) {
    try {
      const targets = (await cdpClient.getTargets()) as Array<{
        type?: string
        url?: string
        targetId?: string
      }>
      const fallbackTarget = targets.find(
        (target) =>
          target.type === 'page' &&
          /example\.com|http/.test(String(target.url || ''))
      )

      if (fallbackTarget && fallbackTarget.targetId) {
        const newSessionId = await cdpClient.attachToTarget(
          fallbackTarget.targetId
        )
        await cdpClient.waitForContentScriptInjection(newSessionId)
        const retryHtml = await cdpClient.getPageHTML(
          newSessionId,
          includeShadow
        )

        if (logSamples) {
          const sample2 = (retryHtml || '').slice(0, 200).replace(/\n/g, ' ')
          console.log(messages.devHtmlSampleRetry(sample2))
        }

        if (retryHtml) return retryHtml
      }
    } catch {
      // ignore
    }
  }

  if (!html || !CONTENT_HTML_HINT_RE.test(html)) {
    await new Promise((r) => setTimeout(r, 250))

    try {
      const againHtml = await cdpClient.getPageHTML(sessionId, includeShadow)

      if (logSamples) {
        const sample3 = (againHtml || '').slice(0, 200).replace(/\n/g, ' ')
        console.log(messages.devHtmlSampleLate(sample3))
      }

      if (againHtml && CONTENT_HTML_HINT_RE.test(againHtml)) {
        html = againHtml
      }
    } catch {
      // ignore
    }
  }

  if (!html || html.trim().length === 0) {
    for (let i = 0; i < 2; i++) {
      try {
        const evaluatedHtml = (await cdpClient.evaluate(
          sessionId,
          '(() => { try { return String(document.documentElement.outerHTML||"") } catch(e) { return "" } })()'
        )) as string

        if (logSamples) {
          const sample4 = (evaluatedHtml || '')
            .slice(0, 200)
            .replace(/\n/g, ' ')
          console.log(messages.devHtmlSampleLate(sample4))
        }

        if (evaluatedHtml && evaluatedHtml.trim().length > 0) {
          html = evaluatedHtml
          break
        }
      } catch {
        // ignore
      }
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  if (includeShadow === 'all') {
    try {
      const closed = await cdpClient.getClosedShadowRoots(sessionId)
      if (closed.length) {
        const blocks = closed
          .map(
            (r) =>
              `<!-- extjs:closed-shadow-root host="${r.host}"${
                r.truncated ? ' truncated="true"' : ''
              } -->\n${r.html}`
          )
          .join('\n')
        html =
          (html || '') +
          `\n<!-- extjs:closed-shadow-roots count="${closed.length}" -->\n` +
          blocks
      }
    } catch {
      // best-effort; closed-shadow piercing must never fail the extraction
    }
  }

  if (logSamples) {
    console.log(messages.sourceInspectorHTMLExtractionComplete())
  }

  return html || ''
}
