// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Readable, Writable} from 'node:stream'
import WebSocket from 'ws'
import {
  CODES,
  humanError,
  humanLine,
  humanWarn,
  isDebug
} from '../../../helpers/messaging'
import {
  CDP_COMMAND_TIMEOUT_MS,
  CDP_HEARTBEAT_INTERVAL_MS
} from '../../browsers-lib/constants'
import * as messages from '../../browsers-lib/messages'
import type {CdpProtocolMessage, CdpTargetInfo} from '../chromium-types'
import {codedError, declaredCode} from './coded-error'
import {discoverWebSocketDebuggerUrl} from './discovery'
import {getExtensionInfo} from './extensions'
import {claimCdpPipe, guardCdpPipe} from './pipe-guard'
import {establishBrowserConnection} from './ws'

// Restrict browser-root auto-attach to extension-relevant target types;
// attaching pages/iframes trips anti-debug checks in third-party OAuth popups.
export const EXTENSION_AUTO_ATTACH_FILTER: Array<{
  type?: string
  exclude?: boolean
}> = [{type: 'page', exclude: true}, {type: 'iframe', exclude: true}, {}]

export class CDPClient {
  private port: number
  private host: string
  private transport: 'websocket' | 'pipe' = 'websocket'
  private ws: WebSocket | null = null
  private pipeIn: Readable | null = null
  private pipeOut: Writable | null = null
  private transportGoneReason: string | undefined
  public onTransportGone: ((reason: string) => void) | undefined
  private pipeBuffer: Buffer = Buffer.alloc(0)
  // Our own pipe listeners, so disconnect can take exactly these off again.
  private detachPipeListeners: (() => void) | undefined
  private targetWebSocketUrl: string | null = null
  private eventCallbacks = new Set<(message: CdpProtocolMessage) => void>()
  private messageId = 0
  private pendingRequests = new Map<
    number,
    {
      resolve: Function
      reject: Function
      timeout?: ReturnType<typeof setTimeout>
      method?: string
    }
  >()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatStallWarned = false

  constructor(port: number = 9222, host: string = '127.0.0.1') {
    this.port = port
    this.host = host
  }

  private isDev() {
    return isDebug()
  }

  async connect(): Promise<void> {
    try {
      this.targetWebSocketUrl = await discoverWebSocketDebuggerUrl(
        this.host,
        this.port,
        this.isDev()
      )

      let pendingRejected = false
      this.ws = await establishBrowserConnection(
        this.targetWebSocketUrl!,
        this.isDev(),
        (data) => this.handleMessage(data),
        (reason) => {
          // Guard against double-rejection (error + close fire in sequence)
          if (pendingRejected) return

          pendingRejected = true
          // Reject any pending requests to avoid hangs
          this.pendingRequests.forEach(({reject, timeout}, id) => {
            try {
              reject(new Error(reason))
            } catch {
              // Ignore
            }

            if (timeout) clearTimeout(timeout)

            this.pendingRequests.delete(id)
          })

          // Mark ws as dead so sendCommand rejects immediately
          this.ws = null
        }
      )

      this.transport = 'websocket'
      this.startHeartbeat()

      if (this.isDev()) {
        humanLine(messages.cdpClientConnected(this.host, this.port))
      }
    } catch (error) {
      const err = error as Error

      throw codedError(
        declaredCode(err) ?? CODES.E_CDP_NOT_CONNECTED,
        `Failed to connect to CDP: ${err.message || err}`
      )
    }
  }

  async connectViaPipe(input: Readable, output: Writable): Promise<void> {
    this.transport = 'pipe'
    this.pipeIn = input
    this.pipeOut = output
    this.pipeBuffer = Buffer.alloc(0)

    const onData = (chunk: Buffer) => {
      this.pipeBuffer = Buffer.concat([this.pipeBuffer, chunk])
      let idx: number

      while ((idx = this.pipeBuffer.indexOf(0)) !== -1) {
        const msg = this.pipeBuffer.subarray(0, idx).toString('utf-8')
        this.pipeBuffer = this.pipeBuffer.subarray(idx + 1)
        this.handleMessage(msg)
      }
    }

    const onReadError = (error: Error) => {
      if (this.isDev()) {
        humanError(`[CDP] Pipe read error: ${error.message}`)
      }

      this.rejectAllPending(`CDP pipe read error: ${error.message}`)
      this.markTransportGone(error.message)
    }

    const onClose = () => {
      if (this.isDev()) humanLine('[CDP] Pipe closed')

      this.rejectAllPending('CDP pipe closed')
      this.pipeIn = null
      this.markTransportGone('the browser closed the CDP pipe')
    }

    // A browser that dies mid-write makes the write side emit EPIPE. With no
    // listener that reaches the top-level sink as an uncaught exception, which
    // reads as a fault in the dev server rather than a browser that went away.
    const onWriteError = (error: Error) => {
      if (this.isDev()) {
        humanLine(`[CDP] Pipe write error: ${error.message}`)
      }

      this.rejectAllPending(`CDP pipe write error: ${error.message}`)
      this.pipeOut = null
      this.markTransportGone(error.message)
    }

    guardCdpPipe(input)
    guardCdpPipe(output)
    claimCdpPipe(input, this)
    claimCdpPipe(output, this)

    input.on('data', onData)
    input.on('error', onReadError)
    input.on('close', onClose)
    output.on('error', onWriteError)

    this.detachPipeListeners = () => {
      input.removeListener('data', onData)
      input.removeListener('error', onReadError)
      input.removeListener('close', onClose)
      output.removeListener('error', onWriteError)
    }

    this.startHeartbeat()

    if (this.isDev()) {
      humanLine(messages.cdpClientConnected(this.host, this.port))
    }
  }

  // Said once, so a close and a write error for the same dead browser do not
  // report it twice. Callers use it to withhold a readiness claim.
  private markTransportGone(reason: string) {
    if (this.transportGoneReason) return

    this.transportGoneReason = reason
    const notify = this.onTransportGone

    if (notify) {
      try {
        notify(reason)
      } catch {
        // Ignore
      }
    }
  }

  // The guard's entry point: a pipe error that arrives once this client has
  // detached its own listeners still says the browser went away.
  reportPipeGone(error: Error) {
    this.markTransportGone(error?.message || 'the CDP pipe failed')
  }

  isTransportGone(): boolean {
    return Boolean(this.transportGoneReason)
  }

  private rejectAllPending(reason: string) {
    this.pendingRequests.forEach(({reject, timeout}, id) => {
      try {
        reject(new Error(reason))
      } catch {
        // Ignore
      }

      if (timeout) clearTimeout(timeout)

      this.pendingRequests.delete(id)
    })
  }

  disconnect() {
    this.stopHeartbeat()

    if (this.transport === 'pipe') {
      // NEVER end() the pipe here: closing --remote-debugging-pipe is Chromium's
      // shutdown signal; detach quietly, the fds close when our process exits.
      // Only our listeners come off: the streams are the child's stdio, and
      // child_process counts their close events to fire the child's own
      // 'close', which is where a browser exit gets reported and stamped.
      try {
        this.detachPipeListeners?.()
        this.detachPipeListeners = undefined
        // Keep draining so Chromium's pipe writer never blocks on a full
        // buffer once nobody consumes events.
        this.pipeIn?.resume()
      } catch {
        // Ignore
      }

      this.pipeIn = null
      this.pipeOut = null
    }

    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        // Ignore
      }

      this.ws = null
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(async () => {
      if (!this.isConnected()) {
        this.stopHeartbeat()

        return
      }

      try {
        await this.getBrowserVersion()
        this.heartbeatStallWarned = false
      } catch {
        if (this.transport === 'pipe') {
          // A timed-out heartbeat over the pipe means the browser is STALLED, not gone
          // (a real death fires pipe 'close'). Log once and keep the heartbeat.
          if (!this.heartbeatStallWarned) {
            this.heartbeatStallWarned = true
            humanWarn(
              '[CDP] Browser is not answering CDP commands (heartbeat timed out). Keeping the session, it resumes automatically if the browser recovers.'
            )
          }

          return
        }

        // WebSocket transport: a dead ws really is dead, close it.
        if (this.isDev()) {
          humanWarn('[CDP] Heartbeat failed, connection appears dead')
        }

        this.disconnect()
      }
    }, CDP_HEARTBEAT_INTERVAL_MS)

    if (typeof this.heartbeatTimer.unref === 'function') {
      this.heartbeatTimer.unref()
    }
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  isConnected(): boolean {
    if (this.transport === 'pipe') {
      return (
        !!this.pipeIn &&
        !this.pipeIn.destroyed &&
        !!this.pipeOut &&
        !this.pipeOut.destroyed
      )
    }

    return !!this.ws && this.ws.readyState === WebSocket.OPEN
  }

  onProtocolEvent(handler: (message: CdpProtocolMessage) => void) {
    this.eventCallbacks.add(handler)

    return () => {
      this.eventCallbacks.delete(handler)
    }
  }

  private handleMessage(data: string) {
    try {
      const message = JSON.parse(data)

      if (message.id) {
        const pending = this.pendingRequests.get(message.id)

        if (pending) {
          if (pending.timeout) {
            clearTimeout(pending.timeout)
          }

          this.pendingRequests.delete(message.id)

          if (message.error) {
            pending.reject(
              codedError(CODES.E_CDP_OP_FAILED, JSON.stringify(message.error))
            )
          } else {
            pending.resolve(message.result)
          }
        }

        return
      }

      if (message.method === 'Target.attachedToTarget') {
        const params = message.params || {}

        if (this.isDev()) {
          humanLine(
            messages.cdpClientAttachedToTarget(
              String(params.sessionId || ''),
              String(params.targetInfo?.type || '')
            )
          )
        }
      }

      for (const eventCallback of this.eventCallbacks) {
        eventCallback(message)
      }
    } catch {
      // Ignore
    }
  }

  async sendCommand(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs: number = CDP_COMMAND_TIMEOUT_MS
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        return reject(
          codedError(CODES.E_CDP_NOT_CONNECTED, 'CDP transport is not open')
        )
      }

      const id = ++this.messageId
      const message: Record<string, unknown> = {id, method, params}
      if (sessionId) message.sessionId = sessionId

      try {
        const timeout = setTimeout(() => {
          const pending = this.pendingRequests.get(id)
          if (!pending) return

          this.pendingRequests.delete(id)

          pending.reject(
            codedError(
              CODES.E_CDP_TIMEOUT,
              `CDP command timed out (${timeoutMs}ms): ${String(
                pending.method || method
              )}`
            )
          )
        }, timeoutMs)

        this.pendingRequests.set(id, {resolve, reject, timeout, method})

        const data = JSON.stringify(message)

        if (this.transport === 'pipe' && this.pipeOut) {
          this.pipeOut.write(`${data}\0`, (error) => {
            if (!error) return

            const pending = this.pendingRequests.get(id)

            if (pending?.timeout) clearTimeout(pending.timeout)

            this.pendingRequests.delete(id)
            this.markTransportGone(error.message)
            reject(error)
          })
        } else if (this.ws) {
          this.ws.send(data)
        }
      } catch (error) {
        const pending = this.pendingRequests.get(id)

        if (pending?.timeout) {
          clearTimeout(pending.timeout)
        }

        this.pendingRequests.delete(id)
        reject(error)
      }
    })
  }

  async getTargets(): Promise<CdpTargetInfo[]> {
    const response = (await this.sendCommand('Target.getTargets')) as
      | {targetInfos?: CdpTargetInfo[]}
      | undefined

    return response?.targetInfos || []
  }

  async getBrowserVersion() {
    const response = (await this.sendCommand('Browser.getVersion')) as
      | {product?: string; userAgent?: string; jsVersion?: string}
      | undefined

    return response || {}
  }

  async attachToTarget(targetId: string) {
    const response = (await this.sendCommand('Target.attachToTarget', {
      targetId,
      flatten: true
    })) as {sessionId?: string}

    return response.sessionId || ''
  }

  async enableAutoAttach() {
    await this.sendCommand('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true
    })
  }

  async enableRuntimeAndLog(sessionId?: string) {
    // Enable across browser for Log domain; Runtime enables per-session
    await this.sendCommand('Log.enable', {}, sessionId)

    if (sessionId) {
      await this.sendCommand('Runtime.enable', {}, sessionId)
    }
  }

  async evaluate(
    sessionId: string,
    expression: string,
    options?: {
      awaitPromise?: boolean
    }
  ): Promise<unknown> {
    const response = (await this.sendCommand(
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        awaitPromise: options?.awaitPromise === true
      },
      sessionId
    )) as {result?: {value?: unknown}}

    return response.result?.value as unknown
  }

  async getExtensionInfo(extensionId: string) {
    try {
      return await getExtensionInfo(this, extensionId)
    } catch (error) {
      throw codedError(
        declaredCode(error) ?? CODES.E_CDP_OP_FAILED,
        messages.cdpClientExtensionInfoFailed(
          extensionId,
          (error as Error).message
        )
      )
    }
  }
}
