// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as http from 'node:http'
import * as net from 'node:net'
import {humanLine, humanWarn} from '../../../helpers/messaging'
import {CDP_HTTP_TIMEOUT_MS} from '../../browsers-lib/constants'
import * as messages from '../../browsers-lib/messages'

async function getJson(
  host: string,
  port: number,
  path: string
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const req = http.request(
      {hostname: host, port, path, method: 'GET'},
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (e) {
            reject(new Error(`Failed to parse ${path}: ${e}`))
          }
        })
      }
    )
    req.on('error', (err) => reject(err))
    req.setTimeout(CDP_HTTP_TIMEOUT_MS, () => {
      req.destroy(new Error(`CDP endpoint timed out: ${path}`))
    })
    req.end()
  })
}

export async function discoverWebSocketDebuggerUrl(
  host: string,
  port: number,
  isDev: boolean
): Promise<string> {
  try {
    const version = (await getJson(host, port, '/json/version')) as Record<
      string,
      unknown
    >
    const wsUrl =
      typeof version?.webSocketDebuggerUrl === 'string'
        ? version.webSocketDebuggerUrl
        : undefined
    if (wsUrl) {
      if (isDev) {
        humanLine(messages.cdpClientTargetWebSocketUrlStored())
      }
      return wsUrl
    }
  } catch (error: unknown) {
    if (isDev) {
      humanWarn(
        '[CDP] Failed to read /json/version:',
        String((error as Error)?.message || error)
      )
    }
  }

  const targets = (await getJson(host, port, '/json')) as Array<
    Record<string, unknown>
  >
  if (isDev) {
    humanLine(messages.cdpClientFoundTargets((targets || []).length || 0))
  }

  const pageTarget = (targets || []).find((target) => {
    const type = String(target?.type || '')
    const ws =
      typeof target?.webSocketDebuggerUrl === 'string'
        ? (target.webSocketDebuggerUrl as string)
        : ''
    return type === 'page' && ws
  }) as Record<string, unknown> | undefined

  const pageWs =
    typeof pageTarget?.webSocketDebuggerUrl === 'string'
      ? (pageTarget.webSocketDebuggerUrl as string)
      : ''
  if (pageWs) {
    if (isDev) {
      humanLine(messages.cdpClientTargetWebSocketUrlStored())
    }
    return pageWs
  }

  throw new Error('No CDP WebSocket URL available')
}

export async function checkChromeRemoteDebugging(
  port: number = 9222,
  host: string = '127.0.0.1'
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()

    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })

    socket.on('error', () => {
      resolve(false)
    })

    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })

    socket.setTimeout(2000)
    socket.connect(port, host)
  })
}
