import * as sourceMessages from '../../browsers-lib/messages'

interface RdpClientLike {
  request: (payload: unknown) => Promise<unknown>
  getTargetFromDescriptor?: (descriptorId: string) => Promise<unknown>
}

export async function evaluate(
  client: RdpClientLike,
  tabId: string,
  expression: string
) {
  const tryTypes = ['evaluateJS', 'evaluateJSAsync', 'eval', 'evalWithOptions']
  let lastError: unknown = null

  for (const type of tryTypes) {
    try {
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
      const response = (await client.request(payload)) as
        | {result?: unknown; value?: unknown}
        | unknown
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
  const tryTypes = ['evaluateJS', 'evaluateJSAsync', 'eval', 'evalWithOptions']
  let lastError: unknown = null

  for (const type of tryTypes) {
    try {
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

      return await client.request(payload)
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
    const response = await client.request({
      to: actorToUse,
      type: 'evaluateJS',
      text: '(()=>{try{return String(new XMLSerializer().serializeToString(document));}catch(e){return String(document.documentElement.outerHTML)}})()'
    })

    return await coerceResponseToString(client, actorToUse, response)
  } catch {
    // Ignore
  }

  try {
    const response = await client.request({
      to: actorToUse,
      type: 'evaluateJS',
      text: '(()=>String(document.documentElement.outerHTML))()'
    })
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
  const expr = `(() => { try { const host = document.getElementById('extension-root'); if (!host || !host.shadowRoot) return ''; const s = new XMLSerializer(); return Array.from(host.shadowRoot.childNodes).map(n => { try { return s.serializeToString(n) } catch (e) { return '' } }).join(''); } catch { return ''; } })()`
  const looksIncomplete = (html: string) =>
    !html || html.length < 100 || !/content_script/.test(html)
  let attempts = 0
  let html = ''

  while (attempts < 6) {
    try {
      const response = await client.request({
        to: actorToUse,
        type: 'evaluateJS',
        text: expr
      })
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
  console.log(sourceMessages.firefoxRdpClientTestingEvaluation())
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
    console.log(sourceMessages.firefoxRdpClientFailedToGetMainHTML())
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
      `(() => { try { var cloned = document.documentElement.cloneNode(true); var host = cloned.querySelector('#extension-root'); if (!host) { var body = cloned.querySelector('body') || cloned; var newRoot = document.createElement('div'); newRoot.id='extension-root'; body.appendChild(newRoot); host = newRoot; } var s = new XMLSerializer(); var shadow = ''; try { var live = document.getElementById('extension-root'); if (live && live.shadowRoot) { shadow = Array.from(live.shadowRoot.childNodes).map(function(n){ try { return s.serializeToString(n) } catch(e){ return '' } }).join(''); } } catch(e) {} try { host.innerHTML = shadow; } catch(e) {} return String('<!DOCTYPE html>' + (cloned.outerHTML || document.documentElement.outerHTML)); } catch(e) { try { return String(document.documentElement.outerHTML); } catch(_) { return '' } } })()`
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
