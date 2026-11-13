// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {humanWarn} from '../../helpers/messaging'
import type {BootRegistrationsWait} from '../browsers-types'
import * as messages from './messages'

// A page that loads before a registerContentScripts call the background made
// as it started has answered never runs that script, and nothing says so.

export const BOOT_REGISTRATIONS_WAIT_MS = 5000

// The dev server answers first, with its own timer or with a background that
// gave up on a call. This one covers a wait that never answers at all.
const OWN_TIMER_SLACK_MS = 250

export type BootRegistrationsHold = 'none' | 'settled' | 'timeout'

export async function holdForBootRegistrations(
  plugin: {awaitBootRegistrations?: BootRegistrationsWait},
  url: string,
  options: {timeoutMs?: number; warn?: (line: string) => void} = {}
): Promise<BootRegistrationsHold> {
  const wait = plugin.awaitBootRegistrations

  // No wait was handed over: the background registers nothing as it starts.
  if (!wait) return 'none'

  const timeoutMs = options.timeoutMs ?? BOOT_REGISTRATIONS_WAIT_MS
  const startedAt = Date.now()
  let ownTimer: ReturnType<typeof setTimeout> | undefined
  let outcome: 'settled' | 'timeout' = 'timeout'

  try {
    outcome = await Promise.race([
      wait(timeoutMs),
      new Promise<'timeout'>((resolve) => {
        ownTimer = setTimeout(
          () => resolve('timeout'),
          timeoutMs + OWN_TIMER_SLACK_MS
        )
      })
    ])
  } catch {
    outcome = 'timeout'
  } finally {
    clearTimeout(ownTimer)
  }

  if (outcome !== 'settled') {
    outcome = 'timeout'
    ;(options.warn ?? humanWarn)(
      messages.startingUrlOpenedBeforeBootRegistrations(
        url,
        Date.now() - startedAt
      )
    )
  }

  return outcome
}
