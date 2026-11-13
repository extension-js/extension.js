// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {FIREFOX_LAUNCH_TAB_URL} from '../../../browsers-lib/runtime-options'

// The launch opens a blank tab and this opens the starting URL, once the
// add-on is installed and its background runs: a page that loads earlier
// never gets the add-on's document_start content scripts and CSS.

const BACKGROUND_WAIT_MS = 5000
const POLL_INTERVAL_MS = 100

export interface StartingUrlClient {
  request: (payload: Record<string, unknown>) => Promise<unknown>
}

type AddonEntry = {id?: string; backgroundScriptStatus?: string}
type TabDescriptor = {actor?: string; url?: string; selected?: boolean}

// An add-on without a background lists no status, so there is nothing to
// wait for. Any other answer is waited out until it reads RUNNING.
async function waitForBackground(
  client: StartingUrlClient,
  extensionId: string | undefined,
  timeoutMs: number,
  intervalMs: number
): Promise<void> {
  if (!extensionId) return

  const deadline = Date.now() + timeoutMs

  for (;;) {
    const reply = (await client.request({to: 'root', type: 'listAddons'})) as {
      addons?: AddonEntry[]
    }
    const addon = (reply?.addons || []).find((a) => a?.id === extensionId)
    const status = addon?.backgroundScriptStatus

    if (!addon || !status || status === 'RUNNING') return
    if (Date.now() >= deadline) return

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

// Only the tab the launch opened is taken. A tab the add-on opened reads
// about:blank while it loads, and navigating it would replace the add-on's page.
function pickLaunchTab(tabs: TabDescriptor[]): TabDescriptor | undefined {
  return tabs.find((tab) => tab?.actor && tab.url === FIREFOX_LAUNCH_TAB_URL)
}

async function navigateLaunchTab(
  client: StartingUrlClient,
  url: string
): Promise<boolean> {
  const listed = (await client.request({to: 'root', type: 'listTabs'})) as {
    tabs?: TabDescriptor[]
  }
  const tab = pickLaunchTab(listed?.tabs || [])

  if (!tab?.actor) return false

  const target = (await client.request({to: tab.actor, type: 'getTarget'})) as {
    frame?: {actor?: unknown}
  }
  const frameActor = target?.frame?.actor

  if (typeof frameActor !== 'string' || !frameActor) return false

  await client.request({to: frameActor, type: 'navigateTo', url})

  return true
}

export async function openStartingUrlAfterBackground(options: {
  client: StartingUrlClient
  extensionId?: string
  url: string
  openInNewTab?: (url: string) => Promise<boolean>
  timeoutMs?: number
  intervalMs?: number
}): Promise<'navigated' | 'opened' | 'unavailable'> {
  const {client, extensionId, url} = options

  await waitForBackground(
    client,
    extensionId,
    options.timeoutMs ?? BACKGROUND_WAIT_MS,
    options.intervalMs ?? POLL_INTERVAL_MS
  )

  if (await navigateLaunchTab(client, url)) return 'navigated'

  // The launch tab is gone or taken, so the page gets a tab of its own
  // instead of replacing whatever the add-on or the user put in one.
  if (await options.openInNewTab?.(url)) return 'opened'

  return 'unavailable'
}
