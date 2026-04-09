// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {RdpTransport} from './transport'

const ASYNC_EVALUATION_TIMEOUT_MS = 8000
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
  to: string,
  text: string,
  type: EvaluationType
) {
  const payload: {
    to: string
    type: EvaluationType
    text: string
    options?: {
      url: string
      selectedNodeActor: undefined
      frameActor: undefined
    }
  } = {
    to,
    type,
    text
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

async function requestEvaluationWithType(
  transport: RdpTransport,
  payload: {
    to: string
    type: EvaluationType
    text: string
    options?: unknown
  }
) {
  if (payload.type !== 'evaluateJSAsync') {
    return await transport.request(payload)
  }

  let expectedResultId = ''
  let cleanup = () => {}
  let pendingMessage:
    | {type?: string; resultID?: unknown; error?: unknown}
    | undefined
  const asyncResult = new Promise<AsyncEvaluationOutcome>((resolve) => {
    const listener = (message: {
      type?: string
      resultID?: unknown
      error?: unknown
    }) => {
      if (message.type !== 'evaluationResult') return
      if (!expectedResultId) {
        pendingMessage = message
        return
      }
      if (String(message.resultID || '') !== expectedResultId) return
      cleanup()
      if (message.error) resolve({ok: false, error: message})
      else resolve({ok: true, value: message})
    }
    const timeout = setTimeout(() => {
      transport.removeListener('message', listener)
      resolve({
        ok: false,
        error: new Error(
          'Timed out waiting for Firefox async evaluation result'
        )
      })
    }, ASYNC_EVALUATION_TIMEOUT_MS)
    cleanup = () => {
      clearTimeout(timeout)
      transport.removeListener('message', listener)
    }
    transport.on('message', listener)
  })

  try {
    const response = (await transport.request(payload)) as
      | {resultID?: unknown; type?: unknown}
      | undefined
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

async function requestEvaluation(
  transport: RdpTransport,
  to: string,
  text: string
) {
  let lastError: unknown = null

  for (const type of EVALUATION_TYPES) {
    try {
      return await requestEvaluationWithType(
        transport,
        buildEvaluationPayload(to, text, type)
      )
    } catch (error) {
      lastError = error
    }
  }

  throw lastError || new Error('Failed to evaluate Firefox RDP expression')
}

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
  const encoded = Buffer.from(new URL(url).href).toString('base64')
  await requestEvaluation(
    transport,
    consoleActor,
    `(() => { window.location.assign(atob("${encoded}")); return true; })()`
  )
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
      const response = (await requestEvaluation(
        transport,
        consoleActor,
        `JSON.stringify({href: String(location.href), ready: String(document.readyState)})`
      )) as any

      const raw = response?.result ?? response?.value ?? response
      const serialized =
        typeof raw === 'string'
          ? raw
          : typeof raw?.value === 'string'
            ? raw.value
            : typeof raw?.text === 'string'
              ? raw.text
              : ''
      const value = serialized ? JSON.parse(serialized) : {}

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
