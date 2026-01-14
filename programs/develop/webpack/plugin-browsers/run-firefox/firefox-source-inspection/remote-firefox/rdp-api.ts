// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {RdpTransport} from './transport'

export async function listTabs(transport: RdpTransport) {
  const response = (await transport.request({
    to: 'root',
    type: 'listTabs'
  })) as {
    tabs?: Array<{
      actor?: string
      url?: string
      consoleActor?: string
      webConsoleActor?: string
    }>
  }
  return response.tabs || []
}

export async function addTab(transport: RdpTransport, url: string) {
  return await transport.request({to: 'root', type: 'addTab', url})
}

export async function navigate(
  transport: RdpTransport,
  tabId: string,
  url: string
) {
  await transport.request({to: tabId, type: 'navigateTo', url})
}

export async function attach(transport: RdpTransport, tabId: string) {
  return await transport.request({to: tabId, type: 'attach'})
}

export async function getTargetFromDescriptor(
  transport: RdpTransport,
  descriptorId: string
) {
  return (await transport.request({to: descriptorId, type: 'getTarget'})) as {
    frame?: {actor?: string; consoleActor?: string}
    actor?: string
    target?: {actor?: string; consoleActor?: string}
    tab?: {actor?: string} | string
    webConsoleActor?: string
    consoleActor?: string
  }
}

export async function navigateViaScript(
  transport: RdpTransport,
  consoleActor: string,
  url: string
) {
  await transport.request({
    to: consoleActor,
    type: 'evaluateJS',
    text: `window.location.assign(${JSON.stringify(url)})`
  })
}

export async function waitForPageReady(
  transport: RdpTransport,
  consoleActor: string,
  url: string,
  timeoutMs = 8000
): Promise<void> {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    try {
      const response = (await transport.request({
        to: consoleActor,
        type: 'evaluateJS',
        text: `({href: location.href, ready: document.readyState})`
      })) as any

      const value = response?.result || {}

      if (
        typeof value?.href === 'string' &&
        value.href.startsWith(url) &&
        (value.ready === 'interactive' || value.ready === 'complete')
      )
        return
    } catch {
      // Ignore
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 200))
  }
}

export function waitForLoadEvent(
  transport: RdpTransport,
  tabId: string
): Promise<void> {
  return new Promise<void>((resolve) => {
    let resolved = false

    const listener = (message: {from?: string; type?: string}) => {
      if (
        message.from === tabId &&
        message.type === 'tabNavigated' &&
        !resolved
      ) {
        resolved = true
        resolve()
      }
    }

    transport.on('message', listener)

    setTimeout(() => {
      if (!resolved) resolve()
      transport.removeListener('message', listener)
    }, 10000)
  })
}
