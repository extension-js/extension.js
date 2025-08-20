// This messaging client acts similar to the web-ext rdp-client.
// https://github.com/mozilla/web-ext/blob/master/src/firefox/rdp-client.js.
// For some reason it seems Firefox requires a remote client to add temporary add-ons.

import net from 'net'
import EventEmitter from 'events'
import * as messages from '../../browsers-lib/messages'
import * as sourceMessages from '../../browsers-lib/messages'
import {parseRdpFrame, buildRdpFrame} from '../../browsers-lib/rdp-wire'

interface Message {
  from?: string
  type?: string
  error?: any
}

interface Deferred {
  resolve: (value?: any) => void
  reject: (reason?: any) => void
}

export class MessagingClient extends EventEmitter {
  private incomingData: Buffer = Buffer.alloc(0)
  private pendingRequests: Array<{request: any; deferred: Deferred}> = []
  private readonly activeRequests = new Map<string, Deferred>()
  private connection?: net.Socket

  async connect(port: number) {
    await new Promise<void>((resolve, reject) => {
      try {
        const connectionOptions = {port, host: '127.0.0.1'}
        const conn = net.createConnection(connectionOptions, () => {
          try {
            console.log(
              sourceMessages.firefoxRdpClientConnected('127.0.0.1', port)
            )
          } catch {}
          resolve()
        })
        this.connection = conn

        conn.on('data', this.onData.bind(this))
        conn.on('error', reject)
        conn.on('end', this.onEnd.bind(this))
        conn.on('timeout', this.onTimeout.bind(this))
      } catch (err) {
        reject(err)
      }
    })
  }

  disconnect() {
    if (!this.connection) return
    this.connection.removeAllListeners()
    this.connection.end()
    this.rejectAllRequests(
      new Error(messages.messagingClientClosedError('firefox'))
    )
  }

  private rejectAllRequests(error: Error) {
    this.activeRequests.forEach((deferred) => {
      deferred.reject(error)
    })
    this.activeRequests.clear()
    this.pendingRequests.forEach(({deferred}) => {
      deferred.reject(error)
    })
    this.pendingRequests = []
  }

  async request(requestProps: any) {
    const request =
      typeof requestProps === 'string'
        ? {to: 'root', type: requestProps}
        : requestProps

    if (!request.to) {
      throw new Error(
        messages.requestWithoutTargetActorError('firefox', request.type)
      )
    }
    return await new Promise<any>((resolve, reject) => {
      const deferred = {resolve, reject}
      this.pendingRequests.push({request, deferred})
      this.flushPendingRequests()
    })
  }

  private flushPendingRequests() {
    this.pendingRequests = this.pendingRequests.filter(
      ({request, deferred}: {request: {to: string}; deferred: Deferred}) => {
        if (this.activeRequests.has(request.to)) return true

        if (!this.connection) {
          throw new Error(messages.connectionClosedError('firefox'))
        }

        try {
          this.connection.write(buildRdpFrame(request))
          this.expectReply(request.to, deferred)
        } catch (err) {
          deferred.reject(err)
        }
        return false
      }
    )
  }

  private expectReply(targetActor: string, deferred: Deferred) {
    if (this.activeRequests.has(targetActor)) {
      throw new Error(
        messages.targetActorHasActiveRequestError('firefox', targetActor)
      )
    }
    this.activeRequests.set(targetActor, deferred)
  }

  private onData(data: Buffer) {
    this.incomingData = Buffer.concat([this.incomingData, data])
    while (this.readMessage());
  }

  private readMessage() {
    const {remainingData, parsedMessage, error, fatal} = parseRdpFrame(
      this.incomingData
    )
    this.incomingData = remainingData

    if (error) {
      this.emit(
        'error',
        new Error(messages.parsingPacketError('firefox', error))
      )
      if (fatal) this.disconnect()
      return !fatal
    }

    if (!parsedMessage) return false
    this.handleMessage(parsedMessage)
    return true
  }

  private handleMessage(message: Message) {
    if (!message.from) {
      this.emit(
        'error',
        new Error(messages.messageWithoutSenderError('firefox', message))
      )
      return
    }

    const deferred = this.activeRequests.get(message.from)
    if (deferred) {
      this.activeRequests.delete(message.from)
      if (message.error) {
        deferred.reject(message)
      } else {
        deferred.resolve(message)
      }
      this.flushPendingRequests()
    } else {
      // Unsolicited DevTools events (e.g., tabNavigated)
      this.emit('message', message)
    }
  }

  onError(error: Error) {
    this.emit('error', error)
  }

  onEnd() {
    this.emit('end')
  }

  onTimeout() {
    this.emit('timeout')
  }

  // Source inspection methods for Firefox RDP
  async getTargets() {
    const response: any = await this.request({
      to: 'root',
      type: 'listTabs'
    })
    return response.tabs || []
  }

  async navigate(tabId: string, url: string) {
    await this.request({
      to: tabId,
      type: 'navigateTo',
      url
    })
  }

  async attach(tabId: string) {
    return await this.request({
      to: tabId,
      type: 'attach'
    })
  }

  // Resolve a tab descriptor actor into an actual tab target actor and console actor
  async getTargetFromDescriptor(descriptorId: string) {
    try {
      const response = await this.request({
        to: descriptorId,
        type: 'getTarget'
      })
      try {
        console.log(
          '[firefox][rdp] getTargetFromDescriptor response:',
          JSON.stringify(response)
        )
      } catch {}
      const targetActor =
        response?.frame?.actor ||
        response?.actor ||
        response?.target?.actor ||
        response?.tab?.actor ||
        (typeof response?.tab === 'string' ? response?.tab : undefined)

      const consoleActor =
        response?.frame?.consoleActor ||
        response?.consoleActor ||
        response?.webConsoleActor ||
        response?.target?.consoleActor ||
        undefined

      return {targetActor, consoleActor}
    } catch {
      return {}
    }
  }

  async addTab(url: string) {
    try {
      const res = await this.request({to: 'root', type: 'addTab', url})
      try {
        console.log('[firefox][rdp] addTab response:', JSON.stringify(res))
      } catch {}
      return res
    } catch (e) {
      try {
        console.log(
          '[firefox][rdp] addTab failed:',
          (e as any)?.message || String(e)
        )
      } catch {}
      throw e
    }
  }

  async navigateViaScript(consoleActor: string, url: string) {
    await this.request({
      to: consoleActor,
      type: 'evaluateJS',
      text: `window.location.assign(${JSON.stringify(url)})`
    })
  }

  async waitForPageReady(consoleActor: string, url: string, timeoutMs = 8000) {
    const start = Date.now()

    while (Date.now() - start < timeoutMs) {
      try {
        const res = await this.request({
          to: consoleActor,
          type: 'evaluateJS',
          text: `({href: location.href, ready: document.readyState})`
        })
        const v = (res as any)?.result || {}
        if (
          typeof v?.href === 'string' &&
          v.href.startsWith(url) &&
          (v.ready === 'interactive' || v.ready === 'complete')
        )
          return
      } catch {}

      await new Promise<void>((r) => setTimeout(r, 200))
    }
  }

  async waitForLoadEvent(tabId: string) {
    return new Promise<void>((resolve) => {
      let resolved = false

      // Listen for page load events
      const listener = (message: any) => {
        if (
          message.from === tabId &&
          message.type === 'tabNavigated' &&
          !resolved
        ) {
          resolved = true
          console.log(sourceMessages.firefoxRdpClientPageLoadEventFired())
          resolve()
        }
      }

      // Add temporary listener
      this.on('message', listener)

      // Remove listener after load event or timeout
      setTimeout(() => {
        if (!resolved) {
          resolved = true
          console.log(sourceMessages.firefoxRdpClientLoadEventTimeout())
          try {
            console.log('[firefox][rdp] last message window missed load event')
          } catch {}
          resolve()
        }
        this.removeListener('message', listener)
      }, 10000)
    })
  }

  async evaluate(tabId: string, expression: string) {
    const tryTypes = [
      'evaluateJS',
      'evaluateJSAsync',
      'eval',
      'evalWithOptions'
    ]
    let lastError: any = null
    for (const type of tryTypes) {
      try {
        const payload: any = {to: tabId, type, text: expression}
        if (type === 'evalWithOptions') {
          payload.options = {
            url: '',
            selectedNodeActor: undefined,
            frameActor: undefined
          }
        }
        const response: any = await this.request(payload)
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

  // Evaluate and return the raw protocol response (needed for longString handling)
  async evaluateRaw(tabId: string, expression: string) {
    const tryTypes = [
      'evaluateJS',
      'evaluateJSAsync',
      'eval',
      'evalWithOptions'
    ]
    let lastError: any = null

    for (const type of tryTypes) {
      try {
        const payload: any = {to: tabId, type, text: expression}
        if (type === 'evalWithOptions') {
          payload.options = {
            url: '',
            selectedNodeActor: undefined,
            frameActor: undefined
          }
        }
        return await this.request(payload)
      } catch (err) {
        lastError = err
      }
    }

    throw lastError || new Error('Failed to evaluate expression (raw)')
  }

  private async coerceResponseToString(
    tabId: string,
    response: any,
    opts: {fallbackToFullDocument?: boolean} = {fallbackToFullDocument: true}
  ): Promise<string> {
    const r: any = response ?? {}
    const value: any = r.result ?? r.value ?? r

    if (typeof value === 'string') return value
    if (value && typeof value.value === 'string') return value.value
    if (value && typeof value.text === 'string') return value.text
    if (value && value.preview && typeof value.preview.text === 'string')
      return value.preview.text

    if (value && value.type === 'longString') {
      const initial: string = value.initial || ''
      const length: number =
        typeof value.length === 'number' ? value.length : initial.length
      const actor: string | undefined = value.actor

      if (actor && typeof length === 'number') {
        try {
          const full: any = await this.request({
            to: actor,
            type: 'substring',
            start: 0,
            end: length
          })
          if (full && typeof (full as any).substring === 'string')
            return (full as any).substring
        } catch {}
      }
      return String(initial)
    }

    if (opts.fallbackToFullDocument) {
      try {
        const serialized = await this.evaluateRaw(
          tabId,
          'new XMLSerializer().serializeToString(document)'
        )
        const asString = await this.coerceResponseToString(tabId, serialized, {
          fallbackToFullDocument: false
        })

        if (typeof asString === 'string' && asString.length > 0) return asString
      } catch {}
    }
    return String(value)
  }

  private async resolveActorForEvaluation(
    descriptorActor: string,
    consoleActorHint?: string
  ) {
    let actor = consoleActorHint || descriptorActor
    try {
      const detail: any = await this.getTargetFromDescriptor(descriptorActor)
      const best =
        (detail as any)?.webExtensionInspectedWindowActor ||
        detail?.consoleActor

      if (best) actor = best
    } catch {}
    return actor
  }

  private async serializeDocument(actorToUse: string): Promise<string> {
    try {
      const resp = await this.request({
        to: actorToUse,
        type: 'evaluateJS',
        text: '(()=>{try{return String(new XMLSerializer().serializeToString(document));}catch(e){return String(document.documentElement.outerHTML)}})()'
      })
      return await this.coerceResponseToString(actorToUse, resp)
    } catch {}
    try {
      const resp = await this.request({
        to: actorToUse,
        type: 'evaluateJS',
        text: '(()=>String(document.documentElement.outerHTML))()'
      })
      return await this.coerceResponseToString(actorToUse, resp, {
        fallbackToFullDocument: false
      })
    } catch {}
    return ''
  }

  private async extractShadowContent(actorToUse: string): Promise<string> {
    // Serialize each child inside the shadow root to avoid [object Object] coercion
    const expr = `(() => { try { const host = document.getElementById('extension-root'); if (!host || !host.shadowRoot) return ''; const s = new XMLSerializer(); return Array.from(host.shadowRoot.childNodes).map(n => { try { return s.serializeToString(n) } catch (e) { return '' } }).join(''); } catch { return ''; } })()`
    const looksIncomplete = (html: string) =>
      !html || html.length < 100 || !/content_script/.test(html)
    let attempts = 0
    let html = ''
    while (attempts < 6) {
      try {
        const resp = await this.request({
          to: actorToUse,
          type: 'evaluateJS',
          text: expr
        })
        html = await this.coerceResponseToString(actorToUse, resp, {
          fallbackToFullDocument: false
        })
        if (!looksIncomplete(html)) break
      } catch {}

      attempts += 1
      await new Promise<void>((r) => setTimeout(r, 150))
    }
    if (html && /<html[\s>]/i.test(html)) html = ''
    return html
  }

  private mergeShadowIntoMain(mainHTML: string, shadowContent: string): string {
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
    } catch {}

    return merged
  }

  async getPageHTML(descriptorActor: string, consoleActorHint?: string) {
    console.log(sourceMessages.firefoxRdpClientTestingEvaluation())
    const actorToUse = await this.resolveActorForEvaluation(
      descriptorActor,
      consoleActorHint
    )

    try {
      const titleResp = await this.evaluateRaw(
        actorToUse,
        'String(document.title)'
      )
      await this.coerceResponseToString(actorToUse, titleResp)
    } catch {}

    let mainHTML = await this.serializeDocument(actorToUse)
    if (!mainHTML) {
      console.log(sourceMessages.firefoxRdpClientFailedToGetMainHTML())
      const retry = await this.evaluateRaw(
        actorToUse,
        'new XMLSerializer().serializeToString(document)'
      )
      try {
        mainHTML = await this.coerceResponseToString(actorToUse, retry)
      } catch {
        mainHTML = ''
      }
      if (!mainHTML) return ''
    }

    const shadowContent = await this.extractShadowContent(actorToUse)
    if (!shadowContent) return mainHTML

    // Try page-context full serialization first to avoid any protocol coercion
    try {
      const mergedResp = await this.evaluateRaw(
        actorToUse,
        `(() => { try { var cloned = document.documentElement.cloneNode(true); var host = cloned.querySelector('#extension-root'); if (!host) { var body = cloned.querySelector('body') || cloned; var newRoot = document.createElement('div'); newRoot.id='extension-root'; body.appendChild(newRoot); host = newRoot; } var s = new XMLSerializer(); var shadow = ''; try { var live = document.getElementById('extension-root'); if (live && live.shadowRoot) { shadow = Array.from(live.shadowRoot.childNodes).map(function(n){ try { return s.serializeToString(n) } catch(e){ return '' } }).join(''); } } catch(e) {} try { host.innerHTML = shadow; } catch(e) {} return String('<!DOCTYPE html>' + (cloned.outerHTML || document.documentElement.outerHTML)); } catch(e) { try { return String(document.documentElement.outerHTML); } catch(_) { return '' } } })()`
      )
      const mergedHtml = await this.coerceResponseToString(
        actorToUse,
        mergedResp,
        {fallbackToFullDocument: false}
      )
      if (typeof mergedHtml === 'string' && /<html[\s>]/i.test(mergedHtml)) {
        return mergedHtml
      }
    } catch {}

    // Fallback: Node-side string merge
    return this.mergeShadowIntoMain(mainHTML, shadowContent)
  }

  async closeTab(tabId: string) {
    await this.request({
      to: tabId,
      type: 'close'
    })
  }
}
