// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import {CODES} from '../../../helpers/messaging'
import {declaredCode} from './coded-error'

export type DeveloperModeOutcome =
  | 'already-on'
  | 'enabled'
  | 'skipped'
  | 'unavailable'

export interface DeveloperModeTransport {
  sendCommand(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    timeoutMs?: number
  ): Promise<unknown>
}

// Edge redirects this to edge://extensions and serves the same WebUI API, so
// the whole Chromium family reaches its toggle through the one URL.
const EXTENSIONS_PAGE = 'chrome://extensions'

// One silence earns the page a navigation. More of them end the flip, well
// inside the launch watchdog that otherwise drops the whole CDP setup.
const MAX_SILENT_READS = 3

const READ_DEVELOPER_MODE = `new Promise((resolve) => chrome.developerPrivate.getProfileConfiguration((config) => resolve(!!config.inDeveloperMode)))`

const ENABLE_DEVELOPER_MODE = `new Promise((resolve) => chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode: true}, () => resolve(!chrome.runtime.lastError)))`

// The rig parks the browser windowless, where opening a page to reach the
// WebUI would create the very window the take is avoiding.
export function developerModeFlipIsSafe(browserArgs: string[]): boolean {
  return !browserArgs.some((arg) => arg.startsWith('--no-startup-window'))
}

// Silent is a page that never answered at all, which is not the same as a
// page that answered before its WebUI bindings landed.
export async function evaluateBoolean(
  transport: DeveloperModeTransport,
  sessionId: string,
  expression: string,
  answerTimeoutMs: number
): Promise<boolean | 'silent' | undefined> {
  try {
    const response = (await transport.sendCommand(
      'Runtime.evaluate',
      {expression, awaitPromise: true, returnByValue: true},
      sessionId,
      answerTimeoutMs
    )) as {result?: {value?: unknown}} | undefined

    const value = response?.result?.value

    return typeof value === 'boolean' ? value : undefined
  } catch (error) {
    return declaredCode(error) === CODES.E_CDP_TIMEOUT ? 'silent' : undefined
  }
}

// The toggle a developer would click on chrome://extensions, clicked for them
// on a background tab that closes before it can take focus.
export async function ensureDeveloperMode(options: {
  transport: DeveloperModeTransport
  attempts?: number
  delayMs?: number
  answerTimeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}): Promise<DeveloperModeOutcome> {
  const {transport} = options
  const attempts = options.attempts ?? 10
  const delayMs = options.delayMs ?? 200
  const answerTimeoutMs = options.answerTimeoutMs ?? 2000
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))

  let targetId = ''

  try {
    const created = (await transport.sendCommand('Target.createTarget', {
      url: EXTENSIONS_PAGE,
      background: true
    })) as {targetId?: string} | undefined

    targetId = created?.targetId ?? ''

    if (!targetId) return 'unavailable'

    const attached = (await transport.sendCommand('Target.attachToTarget', {
      targetId,
      flatten: true
    })) as {sessionId?: string} | undefined

    const sessionId = attached?.sessionId ?? ''

    if (!sessionId) return 'unavailable'

    let silences = 0

    for (let attempt = 0; attempt < attempts; attempt++) {
      // The WebUI bindings land a beat after the target exists, so a first
      // read that is neither true nor false means try again, not give up.
      const current = await evaluateBoolean(
        transport,
        sessionId,
        READ_DEVELOPER_MODE,
        answerTimeoutMs
      )

      if (current === true) return 'already-on'

      if (current === false) {
        const enabled = await evaluateBoolean(
          transport,
          sessionId,
          ENABLE_DEVELOPER_MODE,
          answerTimeoutMs
        )

        return enabled === true ? 'enabled' : 'unavailable'
      }

      if (current === 'silent') {
        silences += 1

        // Vivaldi 8.3 creates the target and never commits the url, so the
        // page answers nothing until it is navigated there by hand.
        if (silences > MAX_SILENT_READS) return 'unavailable'

        if (silences === 1) {
          await transport.sendCommand(
            'Page.navigate',
            {url: EXTENSIONS_PAGE},
            sessionId,
            answerTimeoutMs
          )
        }

        continue
      }

      await sleep(delayMs)
    }

    return 'unavailable'
  } catch {
    return 'unavailable'
  } finally {
    if (targetId) {
      try {
        await transport.sendCommand('Target.closeTarget', {targetId})
      } catch {
        // best-effort; the tab dies with the browser anyway
      }
    }
  }
}

// Every extension the browser holds, with its state and why it is off.
const READ_EXTENSION_STATES = `new Promise((resolve) => chrome.developerPrivate.getExtensionsInfo({includeDisabled: true, includeTerminated: true}, (items) => resolve(JSON.stringify((items || []).map((item) => ({path: item.path || '', state: item.state || '', reasons: Object.keys(item.disableReasons || {}).filter((key) => item.disableReasons[key] === true)}))))))`

function sameFolder(left: string, right: string): boolean {
  const spelled = (value: string) =>
    path.resolve(value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

  return spelled(left) === spelled(right)
}

// Why the browser holds the extension at this folder turned off, as its own
// extensions page names it. Empty when it is on, undefined when nothing
// could be read, so a caller never reports a guess.
export async function readGuestDisableReasons(options: {
  transport: DeveloperModeTransport
  extensionPath: string
  attempts?: number
  delayMs?: number
  answerTimeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}): Promise<string[] | undefined> {
  const {transport, extensionPath} = options
  const attempts = options.attempts ?? 10
  const delayMs = options.delayMs ?? 200
  const answerTimeoutMs = options.answerTimeoutMs ?? 2000
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))

  let targetId = ''

  try {
    const created = (await transport.sendCommand('Target.createTarget', {
      url: EXTENSIONS_PAGE,
      background: true
    })) as {targetId?: string} | undefined

    targetId = created?.targetId ?? ''

    if (!targetId) return undefined

    const attached = (await transport.sendCommand('Target.attachToTarget', {
      targetId,
      flatten: true
    })) as {sessionId?: string} | undefined

    const sessionId = attached?.sessionId ?? ''

    if (!sessionId) return undefined

    for (let attempt = 0; attempt < attempts; attempt++) {
      let answer: unknown

      try {
        const response = (await transport.sendCommand(
          'Runtime.evaluate',
          {
            expression: READ_EXTENSION_STATES,
            awaitPromise: true,
            returnByValue: true
          },
          sessionId,
          answerTimeoutMs
        )) as {result?: {value?: unknown}} | undefined

        answer = response?.result?.value
      } catch {
        return undefined
      }

      // The WebUI bindings land a beat after the target exists.
      if (typeof answer !== 'string') {
        await sleep(delayMs)
        continue
      }

      const states = JSON.parse(answer) as Array<{
        path: string
        state: string
        reasons: string[]
      }>
      const guest = states.find(
        (entry) => entry.path && sameFolder(entry.path, extensionPath)
      )

      if (!guest) return undefined

      return guest.state === 'DISABLED' ? guest.reasons : []
    }

    return undefined
  } catch {
    return undefined
  } finally {
    if (targetId) {
      try {
        await transport.sendCommand('Target.closeTarget', {targetId})
      } catch {
        // best-effort; the tab dies with the browser anyway
      }
    }
  }
}
