// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

export type DeveloperModeOutcome =
  | 'already-on'
  | 'enabled'
  | 'skipped'
  | 'unavailable'

export interface DeveloperModeTransport {
  sendCommand(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string
  ): Promise<unknown>
}

// Edge redirects this to edge://extensions and serves the same WebUI API, so
// the whole Chromium family reaches its toggle through the one URL.
const EXTENSIONS_PAGE = 'chrome://extensions'

const READ_DEVELOPER_MODE = `new Promise((resolve) => chrome.developerPrivate.getProfileConfiguration((config) => resolve(!!config.inDeveloperMode)))`

const ENABLE_DEVELOPER_MODE = `new Promise((resolve) => chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode: true}, () => resolve(!chrome.runtime.lastError)))`

// Chromium keeps extensions.ui.developer_mode in the MAC-protected Secure
// Preferences, so a value seeded into the profile is dropped when it loads.
export function developerModeFromProfile(profilePath: string): boolean {
  try {
    const securePath = path.join(profilePath, 'Default', 'Secure Preferences')
    const parsed = JSON.parse(fs.readFileSync(securePath, 'utf-8')) as {
      extensions?: {ui?: {developer_mode?: unknown}}
    }

    return parsed?.extensions?.ui?.developer_mode === true
  } catch {
    return false
  }
}

// The rig parks the browser windowless, where opening a page to reach the
// WebUI would create the very window the take is avoiding.
export function developerModeFlipIsSafe(browserArgs: string[]): boolean {
  return !browserArgs.some((arg) => arg.startsWith('--no-startup-window'))
}

async function evaluateBoolean(
  transport: DeveloperModeTransport,
  sessionId: string,
  expression: string
): Promise<boolean | undefined> {
  try {
    const response = (await transport.sendCommand(
      'Runtime.evaluate',
      {expression, awaitPromise: true, returnByValue: true},
      sessionId
    )) as {result?: {value?: unknown}} | undefined

    const value = response?.result?.value

    return typeof value === 'boolean' ? value : undefined
  } catch {
    return undefined
  }
}

// The toggle a developer would click on chrome://extensions, clicked for them
// on a background tab that closes before it can take focus.
export async function ensureDeveloperMode(options: {
  transport: DeveloperModeTransport
  attempts?: number
  delayMs?: number
  sleep?: (ms: number) => Promise<void>
}): Promise<DeveloperModeOutcome> {
  const {transport} = options
  const attempts = options.attempts ?? 10
  const delayMs = options.delayMs ?? 200
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

    for (let attempt = 0; attempt < attempts; attempt++) {
      // The WebUI bindings land a beat after the target exists, so a first
      // read that is neither true nor false means try again, not give up.
      const current = await evaluateBoolean(
        transport,
        sessionId,
        READ_DEVELOPER_MODE
      )

      if (current === true) return 'already-on'

      if (current === false) {
        const enabled = await evaluateBoolean(
          transport,
          sessionId,
          ENABLE_DEVELOPER_MODE
        )

        return enabled === true ? 'enabled' : 'unavailable'
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
