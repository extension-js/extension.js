// This messaging client acts similar to the web-ext rdp-client.
// https://github.com/mozilla/web-ext/blob/master/src/firefox/rdp-client.js.
// For some reason it seems Firefox requires a remote client to add temporary add-ons.

import net from 'net'
import EventEmitter from 'events'
import * as messages from '../../browsers-lib/messages'
import {DevOptions} from '../../../module'
import * as sourceMessages from '../../../webpack/plugin-reload/reload-lib/messages'

interface Message {
  from?: string
  type?: string
  error?: any
}

interface Deferred {
  resolve: (value?: any) => void
  reject: (reason?: any) => void
}

function parseMessage(
  browser: DevOptions['browser'],
  data: Buffer
): {
  remainingData: Buffer
  parsedMessage?: Message
  error?: Error
  fatal?: boolean
} {
  const dataString = data.toString()
  const separatorIndex = dataString.indexOf(':')

  if (separatorIndex < 1) {
    return {remainingData: data}
  }

  const messageLength = parseInt(dataString.substring(0, separatorIndex), 10)

  if (isNaN(messageLength)) {
    return {
      remainingData: data,
      error: new Error(messages.parseMessageLengthError(browser)),
      fatal: true
    }
  }

  if (data.length - (separatorIndex + 1) < messageLength) {
    return {remainingData: data}
  }

  const messageContent = data.slice(
    separatorIndex + 1,
    separatorIndex + 1 + messageLength
  )
  const remainingData = data.slice(separatorIndex + 1 + messageLength)

  try {
    const parsedMessage = JSON.parse(messageContent.toString())
    return {remainingData, parsedMessage}
  } catch (error: any) {
    return {remainingData, error, fatal: false}
  }
}

export class MessagingClient extends EventEmitter {
  private incomingData: Buffer = Buffer.alloc(0)
  private pendingRequests: Array<{request: any; deferred: Deferred}> = []
  private readonly activeRequests = new Map<string, Deferred>()
  private connection?: net.Socket

  async connect(port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      try {
        const connectionOptions = {port, host: '127.0.0.1'}
        const conn = net.createConnection(connectionOptions, () => {
          resolve()
        })
        this.connection = conn

        conn.on('data', this.onData.bind(this))
        conn.on('error', reject)
        conn.on('end', this.onEnd.bind(this))
        conn.on('timeout', this.onTimeout.bind(this))
        this.expectReply('root', {resolve, reject})
      } catch (err) {
        reject(err)
      }
    })
  }

  disconnect(): void {
    if (!this.connection) return
    this.connection.removeAllListeners()
    this.connection.end()
    this.rejectAllRequests(
      new Error(messages.messagingClientClosedError('firefox'))
    )
  }

  private rejectAllRequests(error: Error): void {
    this.activeRequests.forEach((deferred) => {
      deferred.reject(error)
    })
    this.activeRequests.clear()
    this.pendingRequests.forEach(({deferred}) => {
      deferred.reject(error)
    })
    this.pendingRequests = []
  }

  async request(requestProps: any): Promise<any> {
    const request =
      typeof requestProps === 'string'
        ? {to: 'root', type: requestProps}
        : requestProps

    if (!request.to) {
      throw new Error(
        messages.requestWithoutTargetActorError('firefox', request.type)
      )
    }
    return await new Promise((resolve, reject) => {
      const deferred = {resolve, reject}
      this.pendingRequests.push({request, deferred})
      this.flushPendingRequests()
    })
  }

  private flushPendingRequests(): void {
    this.pendingRequests = this.pendingRequests.filter(
      ({request, deferred}: {request: {to: string}; deferred: Deferred}) => {
        if (this.activeRequests.has(request.to)) return true
        if (!this.connection) {
          throw new Error(messages.connectionClosedError('firefox'))
        }
        try {
          const messageString = `${
            Buffer.from(JSON.stringify(request)).length
          }:${JSON.stringify(request)}`
          this.connection.write(messageString)
          this.expectReply(request.to, deferred)
        } catch (err) {
          deferred.reject(err)
        }
        return false
      }
    )
  }

  private expectReply(targetActor: string, deferred: Deferred): void {
    if (this.activeRequests.has(targetActor)) {
      throw new Error(
        messages.targetActorHasActiveRequestError('firefox', targetActor)
      )
    }
    this.activeRequests.set(targetActor, deferred)
  }

  private onData(data: Buffer): void {
    this.incomingData = Buffer.concat([this.incomingData, data])
    while (this.readMessage());
  }

  private readMessage(): boolean {
    const {remainingData, parsedMessage, error, fatal} = parseMessage(
      'firefox',
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

  private handleMessage(message: Message): void {
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
      this.emit(
        'error',
        new Error(
          messages.unexpectedMessageReceivedError(
            'firefox',
            JSON.stringify(message)
          )
        )
      )
    }
  }

  onError(error: Error): void {
    this.emit('error', error)
  }

  onEnd(): void {
    this.emit('end')
  }

  onTimeout(): void {
    this.emit('timeout')
  }

  // Source inspection methods for Firefox RDP
  async getTargets(): Promise<any[]> {
    const response = await this.request({
      to: 'root',
      type: 'listTabs'
    })
    return response.tabs || []
  }

  async navigate(tabId: string, url: string): Promise<void> {
    await this.request({
      to: tabId,
      type: 'navigateTo',
      url
    })
  }

  async waitForLoadEvent(tabId: string): Promise<void> {
    return new Promise((resolve) => {
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
          resolve()
        }
        this.removeListener('message', listener)
      }, 15000)
    })
  }

  async evaluate(tabId: string, expression: string): Promise<any> {
    const response = await this.request({
      to: tabId,
      type: 'evaluateJS',
      text: expression
    })
    return response.result
  }

  async getPageHTML(tabId: string): Promise<string> {
    // First, let's test if basic evaluation works
    console.log(sourceMessages.firefoxRdpClientTestingEvaluation())
    const testResult = await this.evaluate(tabId, 'document.title')
    console.log(sourceMessages.firefoxRdpClientDocumentTitle(testResult))

    // Now get the main HTML
    console.log(sourceMessages.firefoxRdpClientGettingMainHTML())
    const mainHTML = await this.evaluate(
      tabId,
      'document.documentElement.outerHTML'
    )
    console.log(
      sourceMessages.firefoxRdpClientMainHTMLLength(
        mainHTML ? mainHTML.length : 0
      )
    )

    if (!mainHTML) {
      console.log(sourceMessages.firefoxRdpClientFailedToGetMainHTML())
      return ''
    }

    // Now check for Shadow DOM
    console.log(sourceMessages.firefoxRdpClientCheckingShadowDOM())
    const shadowContent = await this.evaluate(
      tabId,
      `
      (function() {
        const extensionRoot = document.getElementById('extension-root');
        if (extensionRoot && extensionRoot.shadowRoot) {
          return extensionRoot.shadowRoot.innerHTML;
        }
        return null;
      })()
    `
    )

    console.log(
      sourceMessages.firefoxRdpClientShadowDOMContentFound(!!shadowContent)
    )
    if (shadowContent) {
      console.log(
        sourceMessages.firefoxRdpClientShadowDOMContentLength(
          shadowContent.length
        )
      )
      console.log(sourceMessages.firefoxRdpClientProcessingShadowDOM())

      const finalHTML = await this.evaluate(
        tabId,
        `
        (function() {
          const mainHTML = document.documentElement.outerHTML;
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = mainHTML;
          const extensionRoot = tempDiv.querySelector('#extension-root');
          if (extensionRoot) {
            extensionRoot.innerHTML = ${JSON.stringify(shadowContent)};
          }
          return tempDiv.innerHTML;
        })()
      `
      )
      console.log(
        sourceMessages.firefoxRdpClientFinalHTMLWithShadowDOMLength(
          finalHTML ? finalHTML.length : 0
        )
      )
      return finalHTML || ''
    }

    console.log(sourceMessages.firefoxRdpClientReturningMainHTML())
    return mainHTML || ''
  }

  async closeTab(tabId: string): Promise<void> {
    await this.request({
      to: tabId,
      type: 'close'
    })
  }
}
