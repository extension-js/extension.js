// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import WebSocket from 'ws'
import {
  capEvalValue,
  MAX_RESULT_BYTES,
  TRUNCATED_PREVIEW_CHARS,
  truncatedEvalValue
} from '../../browsers-lib/eval-result-cap'

export interface CdpPageTarget {
  type?: unknown
  url?: unknown
  webSocketDebuggerUrl?: unknown
}

export type CdpEvalOutcome =
  | {ok: true; value: unknown; truncated?: true}
  | {ok: false; error: {name: string; message: string; engine: 'chromium'}}

export interface CdpSession {
  send: (
    method: string,
    params?: Record<string, unknown>
  ) => Promise<Record<string, unknown>>
  close: () => void
}

interface RemoteObject {
  type?: string
  subtype?: string
  value?: unknown
  unserializableValue?: string
  objectId?: string
  className?: string
  description?: string
}

// Two tabs on one url cannot be told apart from here, and a guess would
// answer from a document the caller did not name.
export function pickPageTarget(
  targets: readonly CdpPageTarget[],
  url: string
): string | undefined {
  const matches = targets.filter(
    (target) =>
      target.type === 'page' &&
      target.url === url &&
      typeof target.webSocketDebuggerUrl === 'string' &&
      target.webSocketDebuggerUrl
  )

  return matches.length === 1
    ? String(matches[0].webSocketDebuggerUrl)
    : undefined
}

// Runs in the page on the value itself: the same JSON form the bridge
// answers, cut there so an oversized value never crosses the socket.
const JSON_FORM_FUNCTION = `function () {
  var stack = [];
  var json = JSON.stringify(this, function (_key, val) {
    while (stack.length && stack[stack.length - 1] !== this) stack.pop();
    if (typeof val === "bigint") val = {__type: "bigint", value: String(val)};
    if (val && typeof val === "object") {
      if (stack.indexOf(val) !== -1) return null;
      stack.push(val);
    }
    return val;
  });
  if (typeof json === "string" && json.length > ${MAX_RESULT_BYTES}) {
    return {truncated: true, preview: json.slice(0, ${TRUNCATED_PREVIEW_CHARS})};
  }
  return json;
}`

function refuse(name: string, message: string): CdpEvalOutcome {
  return {ok: false, error: {name, message, engine: 'chromium'}}
}

function thrownOutcome(details: Record<string, unknown>): CdpEvalOutcome {
  const exception = (details.exception || {}) as RemoteObject
  const name = exception.className || 'EvalError'
  const firstLine = String(exception.description || '').split(/\r?\n/)[0]
  const prefix = `${name}: `
  const message = firstLine.startsWith(prefix)
    ? firstLine.slice(prefix.length)
    : firstLine ||
      (exception.value !== undefined
        ? String(exception.value)
        : String(details.text || 'the expression threw'))

  return refuse(name, message)
}

function primitiveValue(result: RemoteObject): unknown {
  if (result.type === 'bigint') {
    return {
      __type: 'bigint',
      value: String(result.unserializableValue || '').replace(/n$/, '')
    }
  }

  // NaN and the infinities have no JSON form and read as null there.
  if (result.unserializableValue !== undefined) {
    return result.unserializableValue === '-0' ? 0 : null
  }

  return result.value
}

// The expression is the protocol's own top-level evaluation, which a page
// policy that forbids eval does not govern, so it is never wrapped in one.
export async function evaluateThroughSession(
  session: CdpSession,
  expression: string
): Promise<CdpEvalOutcome> {
  const evaluated = await session.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: false
  })

  if (evaluated.exceptionDetails) {
    return thrownOutcome(evaluated.exceptionDetails as Record<string, unknown>)
  }

  const result = (evaluated.result || {}) as RemoteObject

  if (!result.objectId || result.type === 'symbol') {
    return capEvalValue(primitiveValue(result))
  }

  // A function has no JSON form, the same undefined the bridge answers.
  if (result.type === 'function') return {ok: true, value: undefined}

  const formed = await session.send('Runtime.callFunctionOn', {
    objectId: result.objectId,
    functionDeclaration: JSON_FORM_FUNCTION,
    returnByValue: true
  })

  if (formed.exceptionDetails) {
    return thrownOutcome(formed.exceptionDetails as Record<string, unknown>)
  }

  const json = ((formed.result || {}) as RemoteObject).value

  if (json && typeof json === 'object') {
    return truncatedEvalValue(String((json as {preview?: unknown}).preview))
  }

  return {
    ok: true,
    value: typeof json === 'string' ? JSON.parse(json) : undefined
  }
}

async function listPageTargets(
  cdpPort: number,
  timeoutMs: number
): Promise<CdpPageTarget[]> {
  const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`, {
    signal: AbortSignal.timeout(timeoutMs)
  })
  const listed = (await response.json()) as unknown

  return Array.isArray(listed) ? (listed as CdpPageTarget[]) : []
}

function connectSession(
  webSocketUrl: string,
  timeoutMs: number
): Promise<CdpSession> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl, {handshakeTimeout: timeoutMs})
    const pending = new Map<
      number,
      {
        resolve: (result: Record<string, unknown>) => void
        reject: (error: Error) => void
      }
    >()
    let nextId = 0

    const failPending = (reason: string) => {
      for (const waiter of pending.values()) waiter.reject(new Error(reason))
      pending.clear()
    }

    socket.on('message', (data: WebSocket.Data) => {
      let frame: {
        id?: number
        result?: Record<string, unknown>
        error?: {message?: string}
      }

      try {
        frame = JSON.parse(data.toString())
      } catch {
        return
      }

      const waiter = typeof frame.id === 'number' && pending.get(frame.id)
      if (!waiter) return

      pending.delete(frame.id as number)

      if (frame.error) {
        waiter.reject(new Error(frame.error.message || 'the debugger refused'))
      } else {
        waiter.resolve(frame.result || {})
      }
    })

    socket.on('close', () => failPending('the debugger connection closed'))

    socket.on('error', (error: Error) => {
      failPending(error.message)
      reject(error)
    })

    socket.on('open', () => {
      resolve({
        send: (method, params = {}) =>
          new Promise((resolveSend, rejectSend) => {
            const id = ++nextId
            pending.set(id, {resolve: resolveSend, reject: rejectSend})
            socket.send(JSON.stringify({id, method, params}))
          }),
        close: () => socket.close()
      })
    })
  })
}

export interface EvaluateChromiumTabOptions {
  cdpPort: number
  url: string
  expression: string
  timeoutMs: number
  listTargets?: (cdpPort: number, timeoutMs: number) => Promise<CdpPageTarget[]>
  connect?: (webSocketUrl: string, timeoutMs: number) => Promise<CdpSession>
}

// Answers nothing when the debugger or the tab cannot be reached, so the
// caller keeps the browser's own refusal, which is the truer account.
export async function evaluateChromiumTabDocument(
  options: EvaluateChromiumTabOptions
): Promise<CdpEvalOutcome | undefined> {
  const {cdpPort, url, expression, timeoutMs} = options
  const listTargets = options.listTargets || listPageTargets
  const connect = options.connect || connectSession

  let session: CdpSession

  try {
    const webSocketUrl = pickPageTarget(
      await listTargets(cdpPort, timeoutMs),
      url
    )

    if (!webSocketUrl) return undefined

    session = await connect(webSocketUrl, timeoutMs)
  } catch {
    return undefined
  }

  let timer: NodeJS.Timeout | undefined

  try {
    return await Promise.race([
      evaluateThroughSession(session, expression),
      new Promise<CdpEvalOutcome>((resolve) => {
        timer = setTimeout(
          () =>
            resolve(
              refuse(
                'Timeout',
                `the expression did not settle in the page within ${timeoutMs}ms`
              )
            ),
          timeoutMs
        )
      })
    ])
  } catch (error) {
    return refuse(
      'Unavailable',
      (error as Error | undefined)?.message ||
        'the debugger connection failed mid-evaluation'
    )
  } finally {
    if (timer) clearTimeout(timer)

    session.close()
  }
}
