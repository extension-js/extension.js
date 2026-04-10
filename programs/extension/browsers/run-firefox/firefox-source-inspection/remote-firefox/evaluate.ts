// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as sourceMessages from '../../../browsers-lib/messages'
import {RDP_EVAL_TIMEOUT_MS} from '../../../browsers-lib/constants'

interface RdpClientLike {
  request: (payload: unknown) => Promise<unknown>
  getTargetFromDescriptor?: (descriptorId: string) => Promise<unknown>
  on?: (event: string, listener: (message: unknown) => void) => unknown
  off?: (event: string, listener: (message: unknown) => void) => unknown
  removeListener?: (
    event: string,
    listener: (message: unknown) => void
  ) => unknown
}

const EVALUATION_TIMEOUT_MS = RDP_EVAL_TIMEOUT_MS
const EVALUATION_TYPES = [
  'evaluateJSAsync',
  'evalWithOptions',
  'evaluateJS',
  'eval'
] as const

type EvaluationType = (typeof EVALUATION_TYPES)[number]

type AsyncEvaluationOutcome =
  | {ok: true; value: unknown}
  | {ok: false; error: unknown}

function buildEvaluationPayload(
  tabId: string,
  expression: string,
  type: EvaluationType
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    to: tabId,
    type,
    text: expression
  }
  if (type === 'evalWithOptions') {
    payload.options = {
      url: '',
      selectedNodeActor: undefined,
      frameActor: undefined
    }
  }
  return payload
}

function getMessageUnsubscriber(
  client: RdpClientLike,
  listener: (message: unknown) => void
): (() => void) | undefined {
  if (typeof client.on !== 'function') return undefined
  client.on('message', listener)
  return () => {
    if (typeof client.off === 'function') {
      client.off('message', listener)
      return
    }
    if (typeof client.removeListener === 'function') {
      client.removeListener('message', listener)
    }
  }
}

async function requestEvaluation(
  client: RdpClientLike,
  tabId: string,
  expression: string,
  type: EvaluationType
): Promise<unknown> {
  if (type !== 'evaluateJSAsync') {
    return await client.request(buildEvaluationPayload(tabId, expression, type))
  }

  let expectedResultId = ''
  let cleanup = () => {}
  let pendingMessage: Record<string, unknown> | undefined
  const asyncResult = new Promise<AsyncEvaluationOutcome>((resolve) => {
    const unsubscribe = getMessageUnsubscriber(client, onMessage)
    if (!unsubscribe) {
      resolve({
        ok: false,
        error: new Error('RDP client does not support async evaluation events')
      })
      return
    }

    const timeout = setTimeout(() => {
      unsubscribe()
      resolve({
        ok: false,
        error: new Error(
          'Timed out waiting for Firefox async evaluation result'
        )
      })
    }, EVALUATION_TIMEOUT_MS)

    cleanup = () => {
      clearTimeout(timeout)
      unsubscribe()
    }

    function onMessage(message: unknown) {
      const payload = (message as Record<string, unknown>) || {}
      if (payload.type !== 'evaluationResult') return
      if (!expectedResultId) {
        pendingMessage = payload
        return
      }
      if (String(payload.resultID || '') !== expectedResultId) return
      cleanup()
      if (payload.error) resolve({ok: false, error: payload})
      else resolve({ok: true, value: message})
    }
  })

  try {
    const response = (await client.request(
      buildEvaluationPayload(tabId, expression, type)
    )) as {resultID?: unknown; type?: unknown}
    if (response?.type === 'evaluationResult') {
      cleanup()
      return response
    }

    expectedResultId = String(response?.resultID || '')
    if (!expectedResultId) {
      cleanup()
      return response
    }
    if (
      pendingMessage &&
      String(pendingMessage.resultID || '') === expectedResultId
    ) {
      cleanup()
      return pendingMessage
    }
    const outcome = await asyncResult
    if (!outcome.ok) {
      throw outcome.error
    }
    return outcome.value
  } catch (error) {
    cleanup()
    throw error
  }
}

export async function evaluate(
  client: RdpClientLike,
  tabId: string,
  expression: string
) {
  let lastError: unknown = null

  for (const type of EVALUATION_TYPES) {
    try {
      const response = (await requestEvaluation(
        client,
        tabId,
        expression,
        type
      )) as {result?: unknown; value?: unknown} | unknown
      const r: any = response ?? {}

      if (r.result !== undefined) return r.result
      if (r.value !== undefined) return r.value

      return r
    } catch (err) {
      lastError = err
    }
  }
  throw lastError || new Error('Failed to evaluate expression')
}

export async function evaluateRaw(
  client: RdpClientLike,
  tabId: string,
  expression: string
) {
  let lastError: unknown = null

  for (const type of EVALUATION_TYPES) {
    try {
      return await requestEvaluation(client, tabId, expression, type)
    } catch (err) {
      lastError = err
    }
  }
  throw lastError || new Error('Failed to evaluate expression (raw)')
}

export async function coerceResponseToString(
  client: RdpClientLike,
  tabId: string,
  response: unknown,
  opts: {fallbackToFullDocument?: boolean} = {fallbackToFullDocument: true}
): Promise<string> {
  const r = (response as any) ?? {}
  const value = r.result ?? r.value ?? r

  if (typeof value === 'string') return value
  if (value && typeof value.value === 'string') return value.value
  if (value && typeof value.text === 'string') return value.text
  if (value && value.preview && typeof value.preview.text === 'string') {
    return value.preview.text
  }

  if (value && value.type === 'longString') {
    const initial: string = value.initial || ''
    const length =
      typeof value.length === 'number' ? value.length : initial.length
    const actor: string | undefined = value.actor

    if (actor && typeof length === 'number') {
      try {
        const full = await client.request({
          to: actor,
          type: 'substring',
          start: 0,
          end: length
        })

        if (full && typeof (full as any).substring === 'string') {
          return (full as any).substring
        }
      } catch {
        // Ignore
      }
    }
    return String(initial)
  }

  if (opts.fallbackToFullDocument) {
    try {
      const serialized = await evaluateRaw(
        client,
        tabId,
        'new XMLSerializer().serializeToString(document)'
      )
      const asString = await coerceResponseToString(client, tabId, serialized, {
        fallbackToFullDocument: false
      })

      if (typeof asString === 'string' && asString.length > 0) return asString
    } catch {
      // Ignore
    }
  }
  return String(value)
}

export async function resolveActorForEvaluation(
  client: RdpClientLike,
  descriptorActor: string,
  consoleActorHint?: string
) {
  let actor = consoleActorHint || descriptorActor

  try {
    const detail =
      ((await client.getTargetFromDescriptor?.(descriptorActor)) as
        | {
            webExtensionInspectedWindowActor?: string
            consoleActor?: string
          }
        | undefined) || undefined
    const best =
      detail?.webExtensionInspectedWindowActor || detail?.consoleActor
    if (best) actor = best
  } catch {
    // Ignore
  }

  return actor
}

export async function serializeDocument(
  client: RdpClientLike,
  actorToUse: string
) {
  try {
    const response = await evaluateRaw(
      client,
      actorToUse,
      '(()=>{try{return String(new XMLSerializer().serializeToString(document));}catch(e){return String(document.documentElement.outerHTML)}})()'
    )
    return await coerceResponseToString(client, actorToUse, response)
  } catch {
    // Ignore
  }

  try {
    const response = await evaluateRaw(
      client,
      actorToUse,
      '(()=>String(document.documentElement.outerHTML))()'
    )
    return await coerceResponseToString(client, actorToUse, response, {
      fallbackToFullDocument: false
    })
  } catch {
    // Ignore
  }

  return ''
}

export async function extractShadowContent(
  client: RdpClientLike,
  actorToUse: string
) {
  const expr = `(() => { try {
    const selector = '#extension-root,[data-extension-root]:not([data-extension-root="extension-js-devtools"])';
    const preferHost = function(root) {
      const nodes = Array.from(root.querySelectorAll(selector));
      return nodes.find(function(node) {
        try {
          const rootKind = String(node.getAttribute('data-extension-root') || '');
          return (
            String(node.id || '') === 'extension-root' ||
            rootKind === 'true' ||
            (rootKind.length > 0 && rootKind !== 'extension-js-devtools')
          );
        } catch (e) {
          return false;
        }
      }) || nodes[0] || null;
    };
    const host = preferHost(document);
    if (!host || !host.shadowRoot) return '';
    const shadowRoot = host.shadowRoot;
    const s = new XMLSerializer();
    const stylesheetCss = Array.from(shadowRoot.styleSheets || [])
      .map(function(sheet) {
        try {
          return Array.from(sheet.cssRules || []).map(function(rule) {
            return String(rule.cssText || '');
          }).join('\\n');
        } catch (e) {
          return '';
        }
      })
      .filter(Boolean)
      .join('\\n');
    const adoptedCss = Array.from(shadowRoot.adoptedStyleSheets || [])
      .map(function(sheet) {
        try {
          return Array.from(sheet.cssRules || []).map(function(rule) {
            return String(rule.cssText || '');
          }).join('\\n');
        } catch (e) {
          return '';
        }
      })
      .filter(Boolean)
      .join('\\n');
    const stylesheetMarkup = stylesheetCss ? '<style>' + stylesheetCss + '</style>' : '';
    const adoptedMarkup = adoptedCss ? '<style>' + adoptedCss + '</style>' : '';
    const childMarkup = Array.from(shadowRoot.childNodes).map(function(node) {
      try {
        if (node && node.nodeType === 1 && String(node.nodeName || '').toLowerCase() === 'style') {
          return '<style>' + String(node.textContent || '') + '</style>';
        }
        return s.serializeToString(node);
      } catch (e) {
        return '';
      }
    }).join('');
    return stylesheetMarkup + adoptedMarkup + childMarkup;
  } catch { return ''; } })()`
  const looksIncomplete = (html: string) =>
    !html || html.length < 100 || !/content_script/.test(html)
  let attempts = 0
  let html = ''

  while (attempts < 6) {
    try {
      const response = await evaluateRaw(client, actorToUse, expr)
      html = await coerceResponseToString(client, actorToUse, response, {
        fallbackToFullDocument: false
      })
      if (!looksIncomplete(html)) break
    } catch {
      // Ignore
    }

    attempts += 1
    await new Promise<void>((r) => setTimeout(r, 150))
  }
  if (html && /<html[\s>]/i.test(html)) html = ''
  return html
}

export function mergeShadowIntoMain(mainHTML: string, shadowContent: string) {
  if (!shadowContent) return mainHTML
  let merged = mainHTML
  try {
    const hasRoot = /<div id=(["'])extension-root\1/i.test(merged)
    if (hasRoot) {
      const replacedEmpty = merged.replace(
        /<div id=(["'])extension-root\1[^>]*><\/div>/i,
        `<div id="extension-root">${shadowContent}</div>`
      )
      if (replacedEmpty !== merged) return replacedEmpty
      merged = merged.replace(
        /<div id=(["'])extension-root\1[^>]*>[\s\S]*?<\/div>/i,
        `<div id="extension-root">${shadowContent}</div>`
      )
    } else if (/<\/body>/i.test(merged)) {
      merged = merged.replace(
        /<\/body>/i,
        `<div id="extension-root">${shadowContent}</div></body>`
      )
    } else {
      merged = `${merged}\n<div id=\"extension-root\">${shadowContent}</div>`
    }
  } catch {
    // Ignore
  }

  return merged
}

export async function getPageHTML(
  client: RdpClientLike,
  descriptorActor: string,
  consoleActorHint?: string
) {
  if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
    console.log(sourceMessages.firefoxRdpClientTestingEvaluation())
  }
  const actorToUse = await resolveActorForEvaluation(
    client,
    descriptorActor,
    consoleActorHint
  )

  try {
    const titleResp = await evaluateRaw(
      client,
      actorToUse,
      'String(document.title)'
    )
    await coerceResponseToString(client, actorToUse, titleResp)
  } catch {
    // Ignore
  }

  let mainHTML = await serializeDocument(client, actorToUse)
  if (!mainHTML) {
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(sourceMessages.firefoxRdpClientFailedToGetMainHTML())
    }
    const retry = await evaluateRaw(
      client,
      actorToUse,
      'new XMLSerializer().serializeToString(document)'
    )
    try {
      mainHTML = await coerceResponseToString(client, actorToUse, retry)
    } catch {
      mainHTML = ''
    }
    if (!mainHTML) return ''
  }

  const shadowContent = await extractShadowContent(client, actorToUse)
  if (!shadowContent) return mainHTML

  try {
    const mergedResp = await evaluateRaw(
      client,
      actorToUse,
      `(() => { try {
        var selector = '#extension-root,[data-extension-root]:not([data-extension-root="extension-js-devtools"])';
        var serializeShadowRoot = function(shadowRoot, serializer) {
          if (!shadowRoot) return '';
          var stylesheetCss = Array.from(shadowRoot.styleSheets || [])
            .map(function(sheet) {
              try {
                return Array.from(sheet.cssRules || []).map(function(rule) {
                  return String(rule.cssText || '');
                }).join('\\n');
              } catch (e) {
                return '';
              }
            })
            .filter(Boolean)
            .join('\\n');
          var adoptedCss = Array.from(shadowRoot.adoptedStyleSheets || [])
            .map(function(sheet) {
              try {
                return Array.from(sheet.cssRules || []).map(function(rule) {
                  return String(rule.cssText || '');
                }).join('\\n');
              } catch (e) {
                return '';
              }
            })
            .filter(Boolean)
            .join('\\n');
          var stylesheetMarkup = stylesheetCss ? '<style>' + stylesheetCss + '</style>' : '';
          var adoptedMarkup = adoptedCss ? '<style>' + adoptedCss + '</style>' : '';
          var childMarkup = Array.from(shadowRoot.childNodes || []).map(function(n) {
            try {
              if (n && n.nodeType === 1 && String(n.nodeName || '').toLowerCase() === 'style') {
                return '<style>' + String(n.textContent || '') + '</style>';
              }
              return serializer.serializeToString(n);
            } catch(e) {
              return '';
            }
          }).join('');
          return stylesheetMarkup + adoptedMarkup + childMarkup;
        };
        var cloned = document.documentElement.cloneNode(true);
        var clonedHosts = Array.from(cloned.querySelectorAll(selector));
        var liveHosts = Array.from(document.querySelectorAll(selector));
        if (!clonedHosts.length) {
          var body = cloned.querySelector('body') || cloned;
          var newRoot = document.createElement('div');
          newRoot.id = 'extension-root';
          body.appendChild(newRoot);
          clonedHosts = [newRoot];
        }
        var s = new XMLSerializer();
        for (var i = 0; i < clonedHosts.length; i++) {
          var host = clonedHosts[i];
          var live = liveHosts[i];
          var shadow = '';
          try {
            if (live && live.shadowRoot) {
              shadow = serializeShadowRoot(live.shadowRoot, s);
            }
          } catch(e) {}
          try { host.innerHTML = shadow; } catch(e) {}
        }
        return String('<!DOCTYPE html>' + (cloned.outerHTML || document.documentElement.outerHTML));
      } catch(e) {
        try { return String(document.documentElement.outerHTML); } catch(_) { return '' }
      } })()`
    )
    const mergedHtml = await coerceResponseToString(
      client,
      actorToUse,
      mergedResp,
      {
        fallbackToFullDocument: false
      }
    )
    if (typeof mergedHtml === 'string' && /<html[\s>]/i.test(mergedHtml)) {
      return mergedHtml
    }
  } catch {
    // Ignore
  }

  return mergeShadowIntoMain(mainHTML, shadowContent)
}
