// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

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

type EvaluationReply = {
  result?: unknown
  value?: unknown
  exception?: unknown
  exceptionMessage?: unknown
  hasException?: unknown
  topLevelAwaitRejected?: unknown
}

function exceptionText(value: unknown): string {
  if (typeof value === 'string') return value

  const initial = (value as {initial?: unknown} | null)?.initial

  return typeof initial === 'string' ? initial : ''
}

export class PageThrewError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PageThrewError'
  }
}

// Gecko answers a throwing expression with a result packet, not a protocol
// error, so the exception fields are the only sign the evaluation failed.
function evaluationFailure(reply: unknown): PageThrewError | undefined {
  if (!reply || typeof reply !== 'object') return undefined

  const r = reply as EvaluationReply
  const message = exceptionText(r.exceptionMessage)
  const threw =
    r.hasException === true ||
    r.topLevelAwaitRejected === true ||
    (r.exception !== undefined && r.exception !== null) ||
    message.length > 0

  if (!threw) return undefined

  return new PageThrewError(message || 'The expression threw inside the page')
}

function buildEvaluationPayload(
  tabId: string,
  expression: string,
  type: EvaluationType,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ...extra,
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
  type: EvaluationType,
  extra?: Record<string, unknown>
): Promise<unknown> {
  if (type !== 'evaluateJSAsync') {
    return await client.request(
      buildEvaluationPayload(tabId, expression, type, extra)
    )
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
      buildEvaluationPayload(tabId, expression, type, extra)
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
  expression: string,
  extra?: Record<string, unknown>
) {
  let lastError: unknown = null

  for (const type of EVALUATION_TYPES) {
    let response: unknown

    try {
      response = await requestEvaluation(client, tabId, expression, type, extra)
    } catch (err) {
      lastError = err

      continue
    }

    // The page ran the expression and it threw: that is the verdict, and
    // another request type would only run it again and bury the message.
    const failure = evaluationFailure(response)
    if (failure) throw failure

    const r = (response ?? {}) as EvaluationReply

    if (r.result !== undefined) return r.result
    if (r.value !== undefined) return r.value

    return r
  }

  throw lastError || new Error('Failed to evaluate expression')
}
