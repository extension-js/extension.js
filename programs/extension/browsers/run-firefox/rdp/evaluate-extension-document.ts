// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {PageThrewError} from './remote-firefox/evaluate'
import {MessagingClient} from './remote-firefox/messaging-client'

const RESULT_SLOT = '__extjsRdpEval'
const FRAME_POLL_INTERVAL_MS = 100
const RESULT_POLL_INTERVAL_MS = 50
const FRAME_WAIT_MS = 2000
// The control bridge caps a result at this size and answers the same shape,
// so one command reads the same whichever route carried it.
const MAX_RESULT_BYTES = 256 * 1024
const TRUNCATED_PREVIEW_CHARS = 1024

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

export interface RdpTabDescriptor {
  actor?: unknown
  url?: unknown
}

export type RdpEvalOutcome =
  | {ok: true; value: unknown; truncated?: true}
  | {ok: false; error: {name: string; message: string; engine: 'firefox'}}

interface EvaluatingClient {
  request: (payload: Record<string, unknown>) => Promise<unknown>
  evaluate: (
    consoleActor: string,
    expression: string,
    extra?: Record<string, unknown>
  ) => Promise<unknown>
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
    var json;
    try { json = JSON.stringify(value); }
    catch (error) { json = JSON.stringify(String(value)); }
    if (json === undefined) return {state: "value"};
    if (json.length > ${MAX_RESULT_BYTES}) {
      return {state: "value", truncated: true, json: JSON.stringify({__type: "truncated", preview: json.slice(0, ${TRUNCATED_PREVIEW_CHARS})})};
    }
    return {state: "value", json: json};
  }
  function thrown(error) {
    var message = (error && error.message) || String(error);
    var name = error && typeof error.name === "string" ? error.name : "";
    return {state: "throw", message: name && message.indexOf(name + ":") !== 0 ? name + ": " + message : message};
  }
  try {
    Promise.resolve((${expression})).then(
      function (value) { settle(encode(value)); },
      function (error) { settle(thrown(error)); }
    );
  } catch (error) {
    settle(thrown(error));
  }
  return "started";
})()`
}

export const POLL_EXPRESSION = `(function () {
  var slot = globalThis.${RESULT_SLOT} || null;
  if (slot && slot.state !== "pending") { try { delete globalThis.${RESULT_SLOT}; } catch (error) {} }
  return JSON.stringify(slot);
})()`

// A console actor compiles source text itself, outside the document's policy.
// The block keeps let and const out of the global scope, so an input runs twice.
export function statementBlock(source: string): string {
  return `{\n${source}\n}`
}

export function readSettledSlot(raw: unknown): RdpEvalOutcome | undefined {
  if (typeof raw !== 'string') return undefined

  let slot: {
    state?: unknown
    json?: unknown
    message?: unknown
    truncated?: unknown
  } | null

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

  let value: unknown = slot.json

  try {
    value = JSON.parse(slot.json)
  } catch {
    // Ignore
  }

  return slot.truncated === true
    ? {ok: true, value, truncated: true}
    : {ok: true, value}
}

// Firefox answers a string past 10,000 characters as a longString grip that
// holds only its head, and the rest is read from the grip's own actor.
export async function readWholeString(
  client: Pick<EvaluatingClient, 'request'>,
  value: unknown,
  limit = Number.POSITIVE_INFINITY
): Promise<unknown> {
  const grip = value as {type?: unknown; actor?: unknown; length?: unknown}

  if (!grip || typeof grip !== 'object' || grip.type !== 'longString') {
    return value
  }

  const length = typeof grip.length === 'number' ? grip.length : 0
  const reply = (await client.request({
    to: String(grip.actor),
    type: 'substring',
    start: 0,
    end: Math.min(length, limit)
  })) as {substring?: unknown}

  if (typeof reply?.substring !== 'string') {
    throw new Error(
      `Firefox holds a ${length}-character result as a long string and did not hand it over`
    )
  }

  return reply.substring
}

function capped(value: unknown): RdpEvalOutcome {
  const json = JSON.stringify(value)

  if (json !== undefined && json.length > MAX_RESULT_BYTES) {
    return {
      ok: true,
      truncated: true,
      value: {
        __type: 'truncated',
        preview: json.slice(0, TRUNCATED_PREVIEW_CHARS)
      }
    }
  }

  return {ok: true, value}
}

// Each grip reads as what JSON.stringify makes of that value inside the
// document, so a statement list answers what the same expression would.
export function readCompletionValue(
  grip: unknown
): RdpEvalOutcome | {objectActor: string} {
  if (grip === null || typeof grip !== 'object') return capped(grip)

  const {type, actor, text} = grip as {
    type?: unknown
    actor?: unknown
    text?: unknown
  }

  if (type === 'object' && typeof actor === 'string') {
    return {objectActor: actor}
  }

  if (type === 'undefined' || type === 'symbol') {
    return {ok: true, value: undefined}
  }

  if (type === 'BigInt') return {ok: true, value: String(text)}
  if (type === '-0') return {ok: true, value: 0}

  if (
    type === 'null' ||
    type === 'NaN' ||
    type === 'Infinity' ||
    type === '-Infinity'
  ) {
    return {ok: true, value: null}
  }

  return refuse(
    'Unsupported',
    `Firefox answered a value of the kind "${String(type)}", which this route cannot read back. Wrap the statements in a function that returns the value`
  )
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

async function evaluateStatements(
  client: EvaluatingClient,
  consoleActor: string,
  source: string
): Promise<RdpEvalOutcome | {objectActor: string}> {
  let completion: unknown

  try {
    completion = await client.evaluate(consoleActor, statementBlock(source))
  } catch (error) {
    if (!(error instanceof PageThrewError)) throw error

    return refuse('EvalError', error.message)
  }

  return readCompletionValue(
    await readWholeString(client, completion, MAX_RESULT_BYTES + 1)
  )
}

export async function evaluateInConsole(options: {
  client: EvaluatingClient
  consoleActor: string
  expression: string
  timeoutMs: number
  where: string
}): Promise<RdpEvalOutcome> {
  const {client, consoleActor, expression, timeoutMs, where} = options

  try {
    await client.evaluate(consoleActor, startExpression(expression))
  } catch (error) {
    if (!(error instanceof PageThrewError)) throw error

    // The wrapper catches whatever the input throws, so it fails to parse
    // only when the input is not one expression, before any of it has run.
    if (!/^SyntaxError\b/.test(error.message)) {
      return refuse('EvalError', error.message)
    }

    const completion = await evaluateStatements(
      client,
      consoleActor,
      expression
    )

    if ('ok' in completion) return completion

    // An object stays in the document as a grip. Binding it as _self lets the
    // same wrapper serialize it there and await it when it is a promise.
    await client.evaluate(consoleActor, startExpression('_self'), {
      selectedObjectActor: completion.objectActor
    })
  }

  const deadline = Date.now() + timeoutMs

  for (;;) {
    const settled = readSettledSlot(
      await readWholeString(
        client,
        await client.evaluate(consoleActor, POLL_EXPRESSION)
      )
    )

    if (settled) return settled

    if (Date.now() >= deadline) {
      return refuse(
        'Timeout',
        `the expression did not settle in ${where} within ${timeoutMs}ms`
      )
    }

    await sleep(RESULT_POLL_INTERVAL_MS)
  }
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

    return await evaluateInConsole({
      client,
      consoleActor,
      expression,
      timeoutMs,
      where: `the ${context} document`
    })
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

async function withDebugger<Outcome>(
  rdpPort: number,
  timeoutMs: number,
  run: (client: EvaluatingClient) => Promise<Outcome>
): Promise<Outcome | RdpEvalOutcome> {
  const client = new MessagingClient()

  try {
    const connected = await connectWithin(client, rdpPort, timeoutMs)

    if (connected === 'timeout') {
      client.disconnect()

      return refuse(
        'Timeout',
        `the Firefox debugger on port ${rdpPort} sent no RDP greeting within ${timeoutMs}ms`
      )
    }
  } catch (error) {
    client.disconnect()

    return refuse(
      'Unavailable',
      `could not reach the Firefox debugger on port ${rdpPort}: ${
        (error as Error | undefined)?.message || 'connection refused'
      }`
    )
  }

  try {
    return await run(client as unknown as EvaluatingClient)
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

export async function evaluateExtensionDocument(options: {
  rdpPort: number
  extensionId: string
  context: string
  pagePath?: string
  expression: string
  timeoutMs: number
}): Promise<RdpEvalOutcome> {
  return await withDebugger(options.rdpPort, options.timeoutMs, (client) =>
    evaluateThroughWatcher({...options, client})
  )
}

// Two tabs on one url cannot be told apart from here, and a guess would
// answer from a document the caller did not name.
export function pickTabDescriptor(
  tabs: readonly RdpTabDescriptor[],
  url: string
): string | undefined {
  const matches = tabs.filter(
    (tab) => typeof tab.actor === 'string' && tab.actor && tab.url === url
  )

  return matches.length === 1 ? String(matches[0].actor) : undefined
}

export async function evaluateThroughTab(options: {
  client: EvaluatingClient
  url: string
  expression: string
  timeoutMs: number
}): Promise<RdpEvalOutcome | undefined> {
  const {client, url, expression, timeoutMs} = options
  const listed = (await client.request({to: 'root', type: 'listTabs'})) as {
    tabs?: RdpTabDescriptor[]
  }
  const descriptor = pickTabDescriptor(listed?.tabs || [], url)

  if (!descriptor) return undefined

  const target = (await client.request({
    to: descriptor,
    type: 'getTarget'
  })) as {
    frame?: {consoleActor?: unknown}
  }
  const consoleActor = target?.frame?.consoleActor

  if (typeof consoleActor !== 'string' || !consoleActor) return undefined

  return await evaluateInConsole({
    client,
    consoleActor,
    expression,
    timeoutMs,
    where: 'the page'
  })
}

// Answers nothing when the debugger or the tab cannot be reached, so the
// caller keeps the page's own refusal, which is the truer account.
export async function evaluateTabDocument(options: {
  rdpPort: number
  url: string
  expression: string
  timeoutMs: number
}): Promise<RdpEvalOutcome | undefined> {
  const outcome = await withDebugger(
    options.rdpPort,
    options.timeoutMs,
    (client) => evaluateThroughTab({...options, client})
  )

  if (outcome && !outcome.ok && outcome.error.name === 'Unavailable') {
    return undefined
  }

  return outcome
}
