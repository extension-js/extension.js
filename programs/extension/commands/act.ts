//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import fs from 'node:fs'
import path from 'node:path'
import type {Command} from 'commander'
import {exitAfterDrain} from '../helpers/exit-after-drain'
import {
  type AnyDevelopModule,
  loadExtensionDevelopBridgeModule
} from '../helpers/extension-develop-runtime'
import {
  commandDescriptions,
  controlDisabledInSession,
  controlDisabledInSessionPlain,
  openSurfaceGestureStep,
  openSurfaceNeedsGesture,
  openSurfaceNeedsGesturePlain
} from '../helpers/messages'
import {
  CODES,
  ENVELOPE,
  type EnvelopeError,
  type ErrorCode
} from '../helpers/messaging'
import {normalizeOutputFormat} from '../helpers/output-flag'
import {
  resolveSessionProjectPath,
  sessionReadyPath
} from '../helpers/session-project-path'
import {formatPrettyLogLine, type LogEventLike} from './logs'

export function readRecentConsole(
  projectPath: string,
  browser: string,
  target: {context?: string; tabId?: number},
  limit: number
): unknown[] {
  const file = path.resolve(
    projectPath,
    'dist',
    'extension-js',
    browser,
    'logs.ndjson'
  )
  let lines: string[]
  try {
    lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)
  } catch {
    return []
  }

  const out: Array<Record<string, unknown>> = []
  for (const line of lines) {
    let e: {
      type?: unknown
      context?: unknown
      tabId?: unknown
      seq?: unknown
      level?: unknown
      messageParts?: unknown
      eventType?: unknown
      code?: unknown
    }
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }

    if (!e || e.type === 'header') continue
    if (target.context && e.context !== target.context) continue
    if (target.tabId != null && e.tabId !== target.tabId) continue

    out.push({
      seq: e.seq,
      level: e.level,
      context: e.context,
      messageParts: e.messageParts,
      eventType: e.eventType,
      code: e.code,
      tabId: e.tabId
    })
  }

  return out.slice(Math.max(0, out.length - limit))
}

type ActContext =
  | 'background'
  | 'popup'
  | 'options'
  | 'sidebar'
  | 'devtools'
  | 'newtab'
  | 'history'
  | 'bookmarks'
  | 'content'
  | 'page'

type CommandOp =
  | 'eval'
  | 'storage.get'
  | 'storage.set'
  | 'reload'
  | 'open'
  | 'tabs.query'
  | 'inspect'

// Bridge command results are dynamic frames; this loose view names the
// fields the CLI probes.
interface ActResultLike {
  ok?: boolean
  value?: unknown
  truncated?: boolean
  error?: {name?: unknown; message?: unknown; engine?: unknown; code?: unknown}
}

interface CommonActOptions {
  browser?: string
  context?: string
  url?: string
  tab?: string
  timeout?: string
  output?: 'pretty' | 'json'
}

// A refusal the CLI can state from what it already knows, before any socket
// is dialed. `message` is the pretty stderr line, `plain` is the envelope copy.
interface Refusal {
  message: string
  plain: string
  code: ErrorCode
  hint?: string
}

interface RunInput {
  projectPathArg?: string
  command: string
  op: CommandOp
  target: {context: ActContext; url?: string; tabId?: number}
  args?: Record<string, unknown>
  needsToken?: boolean
  opts: CommonActOptions
  preflight?: (
    bridge: AnyDevelopModule,
    projectPath: string,
    browser: string
  ) => Refusal | undefined
  augment?: (
    projectPath: string,
    browser: string,
    result: ActResultLike
  ) => Record<string, unknown>
}

// A named refusal from the guest maps straight onto the E_ table. Refusals
// the guest does not name yet fall back to the class name and its prose.
const REFUSAL_TO_CODE: Record<string, ErrorCode> = {
  needs_headed_window: CODES.E_HEADED_WINDOW_REQUIRED,
  needs_user_gesture: CODES.E_USER_GESTURE_REQUIRED,
  surface_not_open: CODES.E_TARGET_NOT_FOUND,
  api_unavailable: CODES.E_NOT_IMPLEMENTED
}

function codeForBridgeError(
  name: string,
  message: string,
  refusal?: string
): ErrorCode {
  if (refusal && refusal in REFUSAL_TO_CODE) return REFUSAL_TO_CODE[refusal]
  if (name === 'Timeout') return CODES.E_TIMEOUT
  if (name === 'Unavailable') return CODES.E_CONTROL_UNAVAILABLE
  if (name === 'EvalTokenMissing') return CODES.E_TOKEN_MISSING
  // Forbidden is the collapsed denial older sessions still send.
  if (
    name === 'EvalDisabled' ||
    name === 'EvalTokenMismatch' ||
    name === 'Forbidden'
  ) {
    return CODES.E_EVAL_REFUSED
  }
  if (name === 'TargetNotFound') return CODES.E_TARGET_NOT_FOUND
  if (name === 'BadRequest') return CODES.E_ARGS
  if (name === 'Unsupported') {
    return /needs a --tab id|is not open/i.test(message)
      ? CODES.E_TARGET_NOT_FOUND
      : CODES.E_NOT_IMPLEMENTED
  }
  // The guest threw while running the op, which is a result, not a CLI fault.
  if (name === 'EvalError') return CODES.E_EVAL
  if (name === 'InspectError') return CODES.E_INSPECT
  if (name === 'StorageError') return CODES.E_STORAGE

  return CODES.E_INTERNAL
}

function statusForCode(code: ErrorCode): string {
  if (code === CODES.E_TIMEOUT) return 'timeout'
  if (code === CODES.E_SESSION_NOT_FOUND || code === CODES.E_TARGET_NOT_FOUND) {
    return 'not-found'
  }
  if (
    code === CODES.E_CONTROL_DENIED ||
    code === CODES.E_EVAL_REFUSED ||
    code === CODES.E_TOKEN_MISSING
  ) {
    return 'denied'
  }
  if (code === CODES.E_ARGS) return 'usage'

  return 'failed'
}

/**
 * Wrap an act frame in the schema-1 envelope without dropping a key. `value`,
 * `truncated`, `error.name`, `error.engine`, `error.hint` and any verb
 * augmentation (`inspect --with-console` merges `console`) are what the MCP
 * reads today, so they keep their exact place.
 */
export function buildActEnvelope(
  command: string,
  result: ActResultLike
): Record<string, unknown> {
  const {ok, value, truncated, error, ...extras} = result as ActResultLike &
    Record<string, unknown>
  const wasTruncated = truncated === true

  // Extras go first so the envelope owns its own keys while a bridge-supplied
  // `hint` and the act augmentations keep their top-level slot.
  if (ok) {
    return {
      ...extras,
      ...ENVELOPE.ok(command, 'ok', value ?? null, {truncated: wasTruncated})
    }
  }

  const raw = (error || {}) as Record<string, unknown>
  const name = typeof raw.name === 'string' ? raw.name : 'Error'
  const message =
    typeof raw.message === 'string' ? raw.message : 'command failed'
  const refusal = typeof raw.code === 'string' ? raw.code : undefined
  const code = codeForBridgeError(name, message, refusal)
  // The bridge error shape carries no hint, so the CLI mints the one the
  // shipped golden documents for a guest throw.
  const hint =
    typeof raw.hint === 'string'
      ? raw.hint
      : code === CODES.E_EVAL
        ? 'The expression threw inside the page. Check the expression itself.'
        : code === CODES.E_USER_GESTURE_REQUIRED
          ? // Chromium gates these surfaces on a real click and there is no way
            // around it from here: the call runs in the extension's own service
            // worker, and an extension cannot gesture at itself. Say what the
            // rule is and what opens the surface, rather than passing the
            // engine's sentence through and leaving the reader to guess.
            'The browser opens this surface only in response to a click, and ' +
            'refuses to open it any other way. Click the extension in the ' +
            'browser toolbar to open it.'
          : undefined

  return {
    ...extras,
    ...ENVELOPE.fail(
      command,
      statusForCode(code),
      {...raw, code, message, name, ...(hint ? {hint} : {})} as EnvelopeError,
      {truncated: wasTruncated}
    )
  }
}

// process.exit can cut a queued console.log on a pipe (#79), and this frame is
// the last thing a machine consumer sees, so write it synchronously.
function writeFrame(frame: unknown): void {
  try {
    fs.writeSync(1, `${JSON.stringify(frame)}\n`)
  } catch {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(frame))
  }
}

interface FailFrame {
  command: string
  code: ErrorCode
  output?: 'pretty' | 'json'
  // Envelope copy without the glyph and colors of the stderr line.
  plain?: string
  hint?: string
}

function fail(message: string, frame?: FailFrame): never {
  // eslint-disable-next-line no-console
  console.error(message)

  if (frame && normalizeOutputFormat(frame.output) === 'json') {
    writeFrame(
      ENVELOPE.fail(frame.command, statusForCode(frame.code), {
        code: frame.code,
        message: frame.plain ?? message,
        name: 'CliError',
        ...(frame.hint ? {hint: frame.hint} : {})
      })
    )
  }

  process.exit(1)
}

// Chromium alone gates popups and the side panel on a real click. Gecko and
// WebKit answer for themselves, so the CLI refuses only where Chromium would.
function isChromiumFamily(browser: string): boolean {
  return !/firefox|gecko|safari|webkit/i.test(browser)
}

// The manifest as the session sees it: the emitted copy first, then the
// source the session names, then the project root.
function readSessionManifest(
  bridge: AnyDevelopModule,
  projectPath: string,
  browser: string
): Record<string, unknown> | undefined {
  const candidates: string[] = []
  const readDocument = bridge?.readReadyContractDocument
  if (typeof readDocument === 'function') {
    try {
      const doc = readDocument(projectPath, browser) as Record<
        string,
        unknown
      > | null
      if (doc && typeof doc.distPath === 'string') {
        candidates.push(path.join(doc.distPath, 'manifest.json'))
      }
      if (doc && typeof doc.manifestPath === 'string') {
        candidates.push(doc.manifestPath)
      }
    } catch {
      // Ignore
    }
  }
  candidates.push(path.join(projectPath, 'manifest.json'))

  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // Ignore
    }
  }

  return undefined
}

// A popup under `action` or `browser_action`, with or without a browser
// prefix, since the source manifest may still carry `chromium:action`.
function manifestDeclaresPopup(manifest: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(manifest)) {
    if (!/(?:^|:)(?:action|browser_action)$/.test(key)) continue
    const popup = (value as {default_popup?: unknown} | null)?.default_popup
    if (typeof popup === 'string' && popup.trim()) return true
  }

  return false
}

// `popup` and `sidebar` always need the click on Chromium. `action` needs it
// only when a popup is declared, since without one the verb replays the
// onClicked listeners, which no gesture rule guards.
function gestureRefusal(
  surface: string,
  bridge: AnyDevelopModule,
  projectPath: string,
  browser: string
): Refusal | undefined {
  if (!isChromiumFamily(browser)) return undefined

  const gated =
    surface === 'popup' ||
    surface === 'sidebar' ||
    (surface === 'action' &&
      manifestDeclaresPopup(
        readSessionManifest(bridge, projectPath, browser) ?? {}
      ))
  if (!gated) return undefined

  return {
    message: openSurfaceNeedsGesture(surface),
    plain: openSurfaceNeedsGesturePlain(surface),
    code: CODES.E_USER_GESTURE_REQUIRED,
    hint: openSurfaceGestureStep(surface)
  }
}

function printResult(
  result: ActResultLike,
  output: 'pretty' | 'json' | undefined,
  command: string
): void {
  if (normalizeOutputFormat(output) === 'json') {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(buildActEnvelope(command, result)))
    return
  }

  if (result.ok) {
    const value = result.value
    // eslint-disable-next-line no-console
    console.log(
      typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    )

    // Augmentations merge extra keys onto the result; `--with-console` was
    // json-only until these lines, so pretty mode looked like a no-op flag.
    const consoleRecords = (result as {console?: unknown}).console
    if (Array.isArray(consoleRecords)) {
      if (consoleRecords.length === 0) {
        // eslint-disable-next-line no-console
        console.log('(no console lines captured)')
      }
      for (const record of consoleRecords) {
        // eslint-disable-next-line no-console
        console.log(formatPrettyLogLine(record as LogEventLike))
      }
    }

    if (result.truncated) {
      // eslint-disable-next-line no-console
      console.error('… result truncated (byte cap)')
    }

    return
  }

  const err = result.error || {name: 'Error', message: 'command failed'}
  // eslint-disable-next-line no-console
  console.error(
    `${err.name}: ${err.message}${err.engine ? ` (engine: ${err.engine})` : ''}`
  )
}

async function runCommand(input: RunInput): Promise<void> {
  const bridge = await loadExtensionDevelopBridgeModule()
  const projectPath = resolveSessionProjectPath(bridge, input.projectPathArg)
  const browser = input.opts.browser || 'chromium'

  const {BridgeController, readReadyContract, readControlToken} = bridge

  const outputFrame = {command: input.command, output: input.opts.output}

  // eval is unlocked by --allow-eval, not --allow-control; a refusal naming
  // the wrong flag sends the user through a wasted dev-server restart.
  const unlockFlag = input.op === 'eval' ? '--allow-eval' : '--allow-control'

  // A refusal the CLI already knows comes before any session lookup, so a
  // surface Chromium never opens this way reads the same with or without a
  // session behind it.
  const refusal = input.preflight?.(bridge, projectPath, browser)
  if (refusal) {
    fail(refusal.message, {
      ...outputFrame,
      code: refusal.code,
      plain: refusal.plain,
      hint: refusal.hint
    })
  }

  const ready = readReadyContract(projectPath, browser)
  if (!ready) {
    fail(
      `No active control channel found for ${browser}. ` +
        `Looked at ${sessionReadyPath(bridge, projectPath, browser)}. ` +
        `Run \`extension dev --browser=${browser} ${unlockFlag}\` first.`,
      {...outputFrame, code: CODES.E_SESSION_NOT_FOUND}
    )
  }

  const token = input.needsToken
    ? readControlToken(projectPath, browser)
    : undefined
  const controller = new BridgeController({
    controlPort: ready.controlPort,
    instanceId: ready.instanceId,
    token: token ?? undefined,
    unlockFlag
  })

  try {
    await controller.connect()
  } catch (err) {
    controller.close()
    const message =
      (err as Error | undefined)?.message ||
      'could not connect to the control channel'
    // 4003 is the session itself saying control is off. The instanceId
    // matched, so no other process answered, and the copy states that fact
    // instead of asking for a flag the caller may already have passed.
    const closeCode = (err as {closeCode?: unknown} | undefined)?.closeCode
    if (closeCode === 4003 || /code 4003\b/.test(message)) {
      fail(controlDisabledInSession(browser, ready.controlPort, unlockFlag), {
        ...outputFrame,
        code: CODES.E_CONTROL_DENIED,
        plain: controlDisabledInSessionPlain(
          browser,
          ready.controlPort,
          unlockFlag
        )
      })
    }
    // A 40xx close is the broker turning the controller away; anything else
    // (handshake timeout, 1006) means the channel never came up at all.
    fail(message, {
      ...outputFrame,
      code: /code 40\d\d/.test(message)
        ? CODES.E_CONTROL_DENIED
        : CODES.E_CONTROL_UNAVAILABLE
    })
  }

  const timeoutMs = input.opts.timeout ? Number(input.opts.timeout) : 5000
  let result: ActResultLike
  try {
    result = await controller.command({
      op: input.op,
      target: input.target,
      args: input.args,
      timeoutMs
    })
  } catch (err) {
    controller.close()
    const message = (err as Error | undefined)?.message || 'command failed'
    fail(message, {
      ...outputFrame,
      code: /timed out/i.test(message)
        ? CODES.E_TIMEOUT
        : CODES.E_CONTROL_UNAVAILABLE
    })
  } finally {
    controller.close()
  }

  if (result?.ok && input.augment) {
    try {
      Object.assign(result, input.augment(projectPath, browser, result))
    } catch {
      // augmentation is best-effort; never fail the command over it
    }
  }

  printResult(result, input.opts.output, input.command)
  await exitAfterDrain(result.ok ? 0 : 1)
}

function targetFrom(
  opts: CommonActOptions,
  fallback: ActContext = 'background'
): {context: ActContext; url?: string; tabId?: number} {
  const context = (opts.context as ActContext) || fallback
  const target: {context: ActContext; url?: string; tabId?: number} = {context}
  if (opts.url) target.url = opts.url
  if (opts.tab != null && opts.tab !== '') target.tabId = Number(opts.tab)

  return target
}

const commonOptions = (cmd: Command): Command =>
  cmd
    .option(
      '--browser <chrome | chromium | edge | firefox>',
      'which session to target (default chromium)'
    )
    .option('--timeout <ms>', 'command timeout in milliseconds (default 5000)')
    .option('--output <pretty|json>', 'output format (default pretty)')

export function registerActCommands(program: Command): void {
  commonOptions(
    program
      .command('eval')
      .arguments('<expression> [project-path]')
      .description(commandDescriptions.eval)
      .option(
        '--context <background|popup|options|sidebar|devtools|newtab|history|bookmarks|content|page>',
        'target context (default background). Extension pages (popup/options/sidebar/devtools/newtab/history/bookmarks) answer via their own in-page relay and must be open'
      )
      .option(
        '--url <glob|substring>',
        'for content/page: document to target (resolved to its tab)'
      )
      .option(
        '--tab <id>',
        'for content/page: a specific tab (default: the --url match, else the active tab)'
      )
  ).action(
    async (
      expression: string,
      projectPathArg: string,
      opts: CommonActOptions
    ) => {
      await runCommand({
        projectPathArg,
        command: 'eval',
        op: 'eval',
        target: targetFrom(opts),
        args: {expression},
        needsToken: true,
        opts
      })
    }
  )

  commonOptions(
    program
      .command('storage')
      .arguments('<action> [project-path]')
      .description(commandDescriptions.storage)
      .option(
        '--area <local|sync|session|managed>',
        'storage area (default local)'
      )
      .option('--key <key>', 'key to get or set')
      .option('--value <json>', 'JSON value to set (with set)')
      .option(
        '--context <background|popup|options|sidebar|content>',
        'target context (default background)'
      )
  ).action(
    async (
      action: string,
      projectPathArg: string,
      opts: CommonActOptions & {area?: string; key?: string; value?: string}
    ) => {
      const area = opts.area || 'local'

      if (action === 'get') {
        await runCommand({
          projectPathArg,
          command: 'storage',
          op: 'storage.get',
          target: targetFrom(opts),
          args: opts.key ? {area, key: opts.key} : {area},
          opts
        })

        return
      }
      if (action === 'set') {
        if (!opts.key || opts.value == null) {
          fail('storage set requires --key and --value', {
            command: 'storage',
            code: CODES.E_ARGS,
            output: opts.output
          })
        }

        let parsed: unknown
        try {
          parsed = JSON.parse(opts.value as string)
        } catch {
          parsed = opts.value // fall back to a raw string value
        }

        await runCommand({
          projectPathArg,
          command: 'storage',
          op: 'storage.set',
          target: targetFrom(opts),
          args: {area, items: {[opts.key as string]: parsed}},
          opts
        })

        return
      }

      fail(`unknown storage action: ${action} (use get or set)`, {
        command: 'storage',
        code: CODES.E_ARGS,
        output: opts.output
      })
    }
  )

  commonOptions(
    program
      .command('reload')
      .arguments('[project-path]')
      .description(commandDescriptions.reload)
      .option(
        '--context <background|content|page>',
        'target context (default background)'
      )
      .option('--tab <id>', 'for content/page: a specific tab')
  ).action(async (projectPathArg: string, opts: CommonActOptions) => {
    await runCommand({
      projectPathArg,
      command: 'reload',
      op: 'reload',
      target: targetFrom(opts),
      opts
    })
  })

  commonOptions(
    program
      .command('inspect')
      .arguments('[project-path]')
      .description(commandDescriptions.inspect)
      .option(
        '--context <content|page|popup|options|sidebar|devtools|newtab|history|bookmarks>',
        'what to inspect: content/page or an open surface, including url-override pages (default content)'
      )
      .option(
        '--url <glob|substring>',
        'for content/page: document to target (resolved to its tab)'
      )
      .option(
        '--tab <id>',
        'for content/page: a specific tab (default: the --url match, else the active tab)'
      )
      .option(
        '--list-tabs',
        'list open tabs as {id,url,title,active,windowId} and exit (pass id to --tab)'
      )
      .option(
        '--include <list>',
        'comma-separated: html,summary (default summary)'
      )
      .option('--max-bytes <n>', 'cap on returned HTML bytes (default 262144)')
      .option(
        '--with-console [n]',
        'also include the last n console lines for the target (default 20)'
      )
  ).action(
    async (
      projectPathArg: string,
      opts: CommonActOptions & {
        include?: string
        maxBytes?: string
        withConsole?: string | boolean
        listTabs?: boolean
      }
    ) => {
      // --list-tabs is a discovery path: surface numeric tab ids so a caller can
      // target eval/inspect explicitly. tabs.query needs no token or DOM. (#51)
      if (opts.listTabs) {
        await runCommand({
          projectPathArg,
          command: 'inspect',
          op: 'tabs.query',
          target: {context: 'background'},
          args: {},
          opts
        })
        return
      }
      const include = opts.include
        ? opts.include
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : ['summary']
      const target = targetFrom(opts, 'content')
      await runCommand({
        projectPathArg,
        command: 'inspect',
        op: 'inspect',
        target,
        args: {
          include,
          maxBytes: opts.maxBytes ? Number(opts.maxBytes) : undefined
        },
        opts,
        augment: opts.withConsole
          ? (projectPath, browser) => {
              const n =
                typeof opts.withConsole === 'string' && opts.withConsole !== ''
                  ? Number(opts.withConsole)
                  : 20
              return {
                console: readRecentConsole(
                  projectPath,
                  browser,
                  target,
                  Number.isFinite(n) && n > 0 ? n : 20
                )
              }
            }
          : undefined
      })
    }
  )

  commonOptions(
    program
      .command('open')
      .arguments('<surface> [project-path]')
      .description(
        'Open an extension surface: popup, options, sidebar, action, or command (requires --allow-control)'
      )
      .option(
        '--name <command>',
        'with `open command`: the chrome.commands name to trigger'
      )
  ).action(
    async (
      surface: string,
      projectPathArg: string,
      opts: CommonActOptions & {name?: string}
    ) => {
      const allowed = ['popup', 'options', 'sidebar', 'action', 'command']
      if (!allowed.includes(surface)) {
        fail(
          `unknown surface: ${surface} (use popup, options, sidebar, action, or command)`,
          {command: 'open', code: CODES.E_ARGS, output: opts.output}
        )
      }
      // 'action' and 'command' replay a captured event in the service worker, so
      // they route to the background context (UI surfaces map 1:1 to a context).
      const inBackground = surface === 'action' || surface === 'command'
      const context: ActContext = inBackground
        ? 'background'
        : (surface as ActContext)
      const args: Record<string, unknown> = {surface}
      if (surface === 'command' && opts.name) args.name = opts.name
      await runCommand({
        projectPathArg,
        command: 'open',
        op: 'open',
        target: {context},
        args,
        opts,
        preflight: (bridge, projectPath, browser) =>
          gestureRefusal(surface, bridge, projectPath, browser)
      })
    }
  )
}
