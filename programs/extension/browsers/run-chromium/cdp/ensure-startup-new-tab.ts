// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  type DeveloperModeTransport,
  evaluateBoolean
} from './ensure-developer-mode'

export type StartupNewTabOutcome = 'set' | 'unavailable'

const SETTINGS_PAGE = 'chrome://settings'
const MAX_SILENT_READS = 3
const NEW_TAB_ON_STARTUP = 5

const SET_NEW_TAB_ON_STARTUP = `chrome.settingsPrivate.setPref('session.restore_on_startup', ${NEW_TAB_ON_STARTUP}).then((done) => !!done)`

function startupPreference(profilePath: string, file: string): unknown {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(profilePath, 'Default', file), 'utf-8')
    ) as {session?: {restore_on_startup?: unknown}}

    return parsed?.session?.restore_on_startup
  } catch {
    return undefined
  }
}

// Chromium keeps session.restore_on_startup under a MAC, drops the value the
// profile seed wrote, and then reopens the pages of the run before.
export function startupSeedWasDropped(profilePath: string): boolean {
  return (
    startupPreference(profilePath, 'Preferences') === NEW_TAB_ON_STARTUP &&
    typeof startupPreference(profilePath, 'Secure Preferences') !== 'number'
  )
}

// The choice a developer would make on chrome://settings, made for them on
// a background tab, so the next launch of this profile opens no old page.
export async function ensureStartupNewTab(options: {
  transport: DeveloperModeTransport
  attempts?: number
  delayMs?: number
  answerTimeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}): Promise<StartupNewTabOutcome> {
  const {transport} = options
  const attempts = options.attempts ?? 10
  const delayMs = options.delayMs ?? 200
  const answerTimeoutMs = options.answerTimeoutMs ?? 2000
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))

  let targetId = ''

  try {
    const created = (await transport.sendCommand('Target.createTarget', {
      url: SETTINGS_PAGE,
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
      // The WebUI bindings land a beat after the target exists, so an answer
      // that is not a boolean means try again.
      const written = await evaluateBoolean(
        transport,
        sessionId,
        SET_NEW_TAB_ON_STARTUP,
        answerTimeoutMs
      )

      if (written === true) return 'set'
      if (written === false) return 'unavailable'

      if (written === 'silent') {
        silences += 1

        if (silences > MAX_SILENT_READS) return 'unavailable'

        if (silences === 1) {
          await transport.sendCommand(
            'Page.navigate',
            {url: SETTINGS_PAGE},
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
        // best-effort, the tab goes with the browser anyway
      }
    }
  }
}
