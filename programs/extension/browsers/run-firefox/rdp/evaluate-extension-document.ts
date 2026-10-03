// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {MessagingClient} from './remote-firefox/messaging-client'

const RESULT_SLOT = '__extjsRdpEval'
const FRAME_POLL_INTERVAL_MS = 100
const RESULT_POLL_INTERVAL_MS = 50
const FRAME_WAIT_MS = 2000

export const EXTENSION_DOCUMENT_CONTEXTS = [
  'background',
  'popup',
  'options',
  'sidebar',
  'devtools',
  'newtab',
  'history',
  'bookmarks'
] as const

export type ExtensionDocumentContext =
  (typeof EXTENSION_DOCUMENT_CONTEXTS)[number]

export function isExtensionDocumentContext(
  context: string
): context is ExtensionDocumentContext {
  return (EXTENSION_DOCUMENT_CONTEXTS as readonly string[]).includes(context)
}

export interface RdpDocumentFrame {
  url?: unknown
  consoleActor?: unknown
  isFallbackExtensionDocument?: unknown
}

export type RdpEvalOutcome =
  | {ok: true; value: unknown}
  | {ok: false; error: {name: string; message: string; engine: 'firefox'}}

interface EvaluatingClient {
  request: (payload: Record<string, unknown>) => Promise<unknown>
  evaluate: (consoleActor: string, expression: string) => Promise<unknown>
  on: (event: string, listener: (message: unknown) => void) => unknown
  off?: (event: string, listener: (message: unknown) => void) => unknown
  removeListener?: (
    event: string,
    listener: (message: unknown) => void
  ) => unknown
}

// The emitted manifest, not the source one: the dev build rewrites every page
// path (a popup.html at the root becomes action/index.html), and the url the
// browser reports is the emitted one.
export function extensionDocumentPagePath(
  manifest: Record<string, unknown>,
  context: string
): string | undefined {
  const read = (...keys: string[]): string | undefined => {
    for (const [key, value] of Object.entries(manifest)) {
      const plain = key.replace(/^[a-z-]+:/, '')
      if (plain !== keys[0]) continue

      if (keys.length === 1) {
        if (typeof value === 'string' && value.trim()) return value

        continue
      }

      const nested = (value as Record<string, unknown> | null)?.[keys[1]]
      if (typeof nested === 'string' && nested.trim()) return nested
    }

    return undefined
  }

  const candidates: Array<string | undefined> = []

  if (context === 'popup') {
    candidates.push(
      read('action', 'default_popup'),
      read('browser_action', 'default_popup')
    )
  } else if (context === 'options') {
    candidates.push(read('options_ui', 'page'), read('options_page'))
  } else if (context === 'sidebar') {
    candidates.push(
      read('side_panel', 'default_path'),
      read('sidebar_action', 'default_panel')
    )
  } else if (context === 'devtools') {
    candidates.push(read('devtools_page'))
  } else if (
    context === 'newtab' ||
    context === 'history' ||
    context === 'bookmarks'
  ) {
    candidates.push(read('chrome_url_overrides', context))
  }

  const page = candidates.find((value) => typeof value === 'string' && value)

  return page ? page.replace(/^\.?\//, '').split(/[?#]/)[0] : undefined
}

// Firefox names the background document of an MV3 add-on
// _generated_background_page.html, and an MV2 one by its own background.html.
const BACKGROUND_DOCUMENT = /\/(?:_generated_background_page|background)\.html$/

export function pickDocumentFrame(
  frames: readonly RdpDocumentFrame[],
  context: string,
  pagePath?: string
): string | undefined {
  const open = frames.filter(
    (frame) =>
      typeof frame.consoleActor === 'string' &&
      frame.consoleActor &&
      typeof frame.url === 'string' &&
      frame.isFallbackExtensionDocument !== true
  )

  const match = open.find((frame) => {
    const url = String(frame.url).split(/[?#]/)[0]

    return context === 'background'
      ? BACKGROUND_DOCUMENT.test(url)
      : Boolean(pagePath) && url.endsWith(`/${pagePath}`)
  })

  return match ? String(match.consoleActor) : undefined
}

// The value is JSON-encoded inside the document and read back as a string:
// a console actor answers an object with an actor grip, not a cloneable value,
// and never awaits a promise the expression returns.
export function startExpression(expression: string): string {
  return `(function () {
  var slot = {state: "pending"};
  globalThis.${RESULT_SLOT} = slot;
  function settle(next) { if (globalThis.${RESULT_SLOT} === slot) globalThis.${RESULT_SLOT} = next; }
  function encode(value) {
    if (value === undefined) return {state: "value"};
    try { return {state: "value", json: JSON.stringify(value)}; }
    catch (error) { return {state: "value", json: JSON.stringify(String(value))}; }
  }
  try {
    Promise.resolve((${expression})).then(
      function (value) { settle(encode(value)); },
      function (error) { settle({state: "throw", message: (error && error.message) || String(error)}); }
    );
  } catch (error) {
    settle({state: "throw", message: (error && error.message) || String(error)});
  }
  return "started";
})()`
}

export const POLL_EXPRESSION = `(function () {
  var slot = globalThis.${RESULT_SLOT} || null;
  if (slot && slot.state !== "pending") { try { delete globalThis.${RESULT_SLOT}; } catch (error) {} }
  return JSON.stringify(slot);
})()`

export function readSettledSlot(raw: unknown): RdpEvalOutcome | undefined {
  if (typeof raw !== 'string') return undefined

  let slot: {state?: unknown; json?: unknown; message?: unknown} | null

  try {
    slot = JSON.parse(raw)
  } catch {
    return undefined
  }

  if (!slot || typeof slot !== 'object') return undefined
  if (slot.state === 'pending') return undefined

  if (slot.state === 'throw') {
    return {
      ok: false,
      error: {
        name: 'EvalError',
        message:
          typeof slot.message === 'string' && slot.message
            ? slot.message
            : 'the expression threw inside the document',
        engine: 'firefox'
      }
    }
  }

  if (slot.state !== 'value') return undefined
  if (typeof slot.json !== 'string') return {ok: true, value: undefined}

  try {
    return {ok: true, value: JSON.parse(slot.json)}
  } catch {
    return {ok: true, value: slot.json}
  }
}

const sleep = (ms: number) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    ;(timer as {unref?: () => void}).unref?.()
  })

function refuse(name: string, message: string): RdpEvalOutcome {
  return {ok: false, error: {name, message, engine: 'firefox'}}
}

async function locateAddonWatcher(
  client: EvaluatingClient,
  extensionId: string
): Promise<{watcherActor: string} | RdpEvalOutcome> {
  const addons = (await client.request({to: 'root', type: 'listAddons'})) as {
    addons?: Array<{actor?: unknown; id?: unknown}>
  }
  const addon = (addons?.addons || []).find(
    (entry) => String(entry?.id || '') === extensionId
  )

  if (!addon || typeof addon.actor !== 'string') {
    return refuse(
      'TargetNotFound',
      `Firefox does not list an add-on with the id ${extensionId}, so there is no document to evaluate in`
    )
  }

  const watcher = (await client.request({
    to: addon.actor,
    type: 'getWatcher'
  })) as {actor?: unknown}

  if (typeof watcher?.actor !== 'string') {
    return refuse(
      'Unsupported',
      'this Firefox build exposes no watcher actor for an add-on, so its documents cannot be evaluated over the protocol'
    )
  }

  return {watcherActor: watcher.actor}
}

export async function evaluateThroughWatcher(options: {
  client: EvaluatingClient
  extensionId: string
  context: string
  pagePath?: string
  expression: string
  timeoutMs: number
}): Promise<RdpEvalOutcome> {
  const {client, extensionId, context, pagePath, expression, timeoutMs} =
    options
  const located = await locateAddonWatcher(client, extensionId)
  if (!('watcherActor' in located)) return located

  const {watcherActor} = located
  const frames: RdpDocumentFrame[] = []

  const onMessage = (message: unknown) => {
    const packet = message as {type?: unknown; target?: RdpDocumentFrame}
    if (packet?.type !== 'target-available-form') return
    if (packet.target) frames.push(packet.target)
  }

  client.on('message', onMessage)

  const stopListening = () => {
    if (typeof client.off === 'function') client.off('message', onMessage)
    else client.removeListener?.('message', onMessage)
  }

  try {
    await client.request({
      to: watcherActor,
      type: 'watchTargets',
      targetType: 'frame'
    })

    const deadline = Date.now() + Math.min(timeoutMs, FRAME_WAIT_MS)
    let consoleActor = pickDocumentFrame(frames, context, pagePath)

    while (!consoleActor && Date.now() < deadline) {
      await sleep(FRAME_POLL_INTERVAL_MS)
      consoleActor = pickDocumentFrame(frames, context, pagePath)
    }

    if (!consoleActor) {
      return refuse(
        'TargetNotFound',
        context === 'background'
          ? "the add-on's background document is not running, so there is nothing to evaluate in"
          : `the ${context} document is not open (open it first: extension open ${context})`
      )
    }

    await client.evaluate(consoleActor, startExpression(expression))

    const resultDeadline = Date.now() + timeoutMs

    for (;;) {
      const settled = readSettledSlot(
        await client.evaluate(consoleActor, POLL_EXPRESSION)
      )

      if (settled) return settled

      if (Date.now() >= resultDeadline) {
        return refuse(
          'Timeout',
          `the expression did not settle in the ${context} document within ${timeoutMs}ms`
        )
      }

      await sleep(RESULT_POLL_INTERVAL_MS)
    }
  } finally {
    stopListening()
    // Firefox sends no reply to unwatchTargets, so awaiting it burns the
    // transport's whole request timeout before the answer can be printed.
    void Promise.resolve(
      client.request({
        to: watcherActor,
        type: 'unwatchTargets',
        targetType: 'frame'
      })
    ).catch(() => {})
  }
}

// The transport waits its own fixed time for the greeting, so a port that
// accepts and never greets is bounded here by the command's --timeout
// instead: the caller was promised an answer inside it.
function connectWithin(
  client: MessagingClient,
  port: number,
  timeoutMs: number
): Promise<'connected' | 'timeout'> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('timeout'), timeoutMs)

    client.connect(port).then(
      () => {
        clearTimeout(timer)
        resolve('connected')
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

export async function evaluateExtensionDocument(options: {
  rdpPort: number
  extensionId: string
  context: string
  pagePath?: string
  expression: string
  timeoutMs: number
}): Promise<RdpEvalOutcome> {
  const client = new MessagingClient()

  try {
    const connected = await connectWithin(
      client,
      options.rdpPort,
      options.timeoutMs
    )

    if (connected === 'timeout') {
      client.disconnect()

      return refuse(
        'Timeout',
        `the Firefox debugger on port ${options.rdpPort} sent no RDP greeting within ${options.timeoutMs}ms`
      )
    }
  } catch (error) {
    client.disconnect()

    return refuse(
      'Unavailable',
      `could not reach the Firefox debugger on port ${options.rdpPort}: ${
        (error as Error | undefined)?.message || 'connection refused'
      }`
    )
  }

  try {
    return await evaluateThroughWatcher({
      ...options,
      client: client as unknown as EvaluatingClient
    })
  } catch (error) {
    return refuse(
      'Unavailable',
      (error as Error | undefined)?.message ||
        'the Firefox debugger connection failed mid-evaluation'
    )
  } finally {
    client.disconnect()
  }
}
