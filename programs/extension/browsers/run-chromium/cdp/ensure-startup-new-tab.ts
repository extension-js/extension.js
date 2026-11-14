// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {DevAdditionEntry} from '../../browsers-lib/ready-stamp'
import {isManagedEphemeralProfile} from '../../browsers-lib/shared-utils'
import {
  type DeveloperModeTransport,
  developerModeFlipIsSafe,
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

const STARTUP_PREFERENCE = 'session.restore_on_startup'
const STARTUP_ENTRY = {
  kind: 'browser_preference',
  value: `${STARTUP_PREFERENCE}=${NEW_TAB_ON_STARTUP}`
}

function keptProfileOf(browserArgs: string[]): string {
  const flag = '--user-data-dir='
  const arg = browserArgs.find((entry) => entry.startsWith(flag))
  const profilePath = arg ? arg.slice(flag.length) : ''

  if (!profilePath || !developerModeFlipIsSafe(browserArgs)) return ''

  return isManagedEphemeralProfile(profilePath) ? '' : profilePath
}

// What a session says about the startup choice before it touches it: whether
// it will be in the kept profile, what decided that, and how to change it.
// A profile deleted on exit keeps nothing, so it has nothing to say.
export function startupPreferenceReport(
  browserArgs: string[]
): DevAdditionEntry | undefined {
  const profilePath = keptProfileOf(browserArgs)
  if (!profilePath) return undefined

  const seeded = startupPreference(profilePath, 'Preferences')
  if (typeof seeded !== 'number') return undefined

  if (seeded !== NEW_TAB_ON_STARTUP) {
    return {
      ...STARTUP_ENTRY,
      applied: false,
      cause: 'preferences',
      reason: `preferences in extension.config.js sets ${STARTUP_PREFERENCE} to ${seeded}, so the session leaves the startup setting of the browser alone`,
      change: `remove ${STARTUP_PREFERENCE} from preferences in extension.config.js to have this profile open a new tab on startup`
    }
  }

  return {
    ...STARTUP_ENTRY,
    applied: true,
    cause: 'default',
    reason:
      'this profile outlives the session, and Chrome would reopen the pages of the run before on its next launch, ahead of the extension. The session sets it once through the browser, and it stays in the profile afterwards',
    change: `set session: {restore_on_startup: 1} under preferences in extension.config.js before the first launch to keep the browser restoring its last session. A profile that already has it keeps it until you change "On startup" in chrome://settings`
  }
}

// The same entry once the browser refused the write.
export function startupPreferenceUnavailable(): DevAdditionEntry {
  return {
    ...STARTUP_ENTRY,
    applied: false,
    cause: 'unavailable',
    reason:
      'the browser did not take the write, so its next launch may reopen the pages of this session',
    change:
      'choose "Open the New Tab page" under "On startup" in chrome://settings'
  }
}

// Whether this launch still has the write to make.
export function startupPreferenceIsDue(browserArgs: string[]): boolean {
  const profilePath = keptProfileOf(browserArgs)

  return Boolean(profilePath) && startupSeedWasDropped(profilePath)
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
