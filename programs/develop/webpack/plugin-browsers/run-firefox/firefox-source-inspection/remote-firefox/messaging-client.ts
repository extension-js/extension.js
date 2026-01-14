// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import EventEmitter from 'events'
import * as messages from '../../../browsers-lib/messages'
import * as sourceMessages from '../../../browsers-lib/messages'
import {RdpTransport} from './transport'
import * as api from './rdp-api'
import {
  evaluate as evalHelper,
  evaluateRaw as evalRaw,
  coerceResponseToString as coerceToString,
  resolveActorForEvaluation as resolveEvalActor,
  serializeDocument as serializeDoc,
  extractShadowContent as extractShadow,
  mergeShadowIntoMain
} from './evaluate'

export class MessagingClient extends EventEmitter {
  private transport = new RdpTransport()

  async connect(port: number) {
    await this.transport.connect(port)
  }

  disconnect() {
    this.transport.disconnect()
  }

  async request(requestProps: unknown) {
    if (typeof requestProps === 'string') {
      return await this.transport.request({to: 'root', type: requestProps})
    }
    if (requestProps && typeof requestProps === 'object') {
      const rp = requestProps as Record<string, unknown>
      const to = typeof rp.to === 'string' ? rp.to : 'root'
      return await this.transport.request({...rp, to})
    }
    throw new Error(messages.rdpInvalidRequestPayload())
  }

  onError(error: Error) {
    this.emit('error', error)
  }

  // Source inspection methods for Firefox RDP
  async getTargets() {
    return await api.listTabs(this.transport)
  }

  async navigate(tabId: string, url: string) {
    await api.navigate(this.transport, tabId, url)
  }

  async attach(tabId: string) {
    return await api.attach(this.transport, tabId)
  }

  // Resolve a tab descriptor actor into an actual tab target actor and console actor
  async getTargetFromDescriptor(descriptorId: string) {
    try {
      const response = await api.getTargetFromDescriptor(
        this.transport,
        descriptorId
      )
      const targetActor =
        response?.frame?.actor ||
        response?.actor ||
        response?.target?.actor ||
        (typeof response?.tab === 'object'
          ? response?.tab?.actor
          : undefined) ||
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
      return await api.addTab(this.transport, url)
    } catch (e) {
      throw e
    }
  }

  async navigateViaScript(consoleActor: string, url: string) {
    await api.navigateViaScript(this.transport, consoleActor, url)
  }

  async waitForPageReady(consoleActor: string, url: string, timeoutMs = 8000) {
    await api.waitForPageReady(this.transport, consoleActor, url, timeoutMs)
  }

  async waitForLoadEvent(tabId: string) {
    await api.waitForLoadEvent(this.transport, tabId)
  }

  async evaluate(tabId: string, expression: string) {
    return evalHelper(this, tabId, expression)
  }

  // Evaluate and return the raw protocol response (needed for longString handling)
  async evaluateRaw(tabId: string, expression: string) {
    return evalRaw(this, tabId, expression)
  }

  private async coerceResponseToString(
    tabId: string,
    response: unknown,
    opts: {fallbackToFullDocument?: boolean} = {fallbackToFullDocument: true}
  ): Promise<string> {
    return coerceToString(this, tabId, response, opts)
  }

  private async resolveActorForEvaluation(
    descriptorActor: string,
    consoleActorHint?: string
  ) {
    return resolveEvalActor(this, descriptorActor, consoleActorHint)
  }

  private async serializeDocument(actorToUse: string): Promise<string> {
    return serializeDoc(this, actorToUse)
  }

  private async extractShadowContent(actorToUse: string): Promise<string> {
    return extractShadow(this, actorToUse)
  }

  private mergeShadowIntoMain(mainHTML: string, shadowContent: string): string {
    return mergeShadowIntoMain(mainHTML, shadowContent)
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
    } catch {
      // Ignore
    }

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
    } catch {
      // Ignore
    }

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
