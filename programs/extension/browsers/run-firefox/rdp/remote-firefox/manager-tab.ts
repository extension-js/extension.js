// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {humanWarn, isDebug} from '../../../../helpers/messaging'
// The manager add-on Extension.js ships with every Firefox session; the only
// context in the browser that can open a tab through the new-tab path.
export const MANAGER_ADDON_ID = 'devtools@extension.js'

// tabs.create without a url lands on BROWSER_NEW_TAB_URL, which is the
// developer's page once Firefox has accepted a chrome_url_overrides.newtab.
// Navigating an existing tab to about:newtab does not take that path.
export const OPEN_NEW_TAB_EXPRESSION =
  '(function () {' +
  ' var api = globalThis.browser || globalThis.chrome;' +
  ' api.tabs.create({active: true});' +
  ' return true;' +
  '})()'

const TARGET_WAIT_MS = 2000

function reportStep(step: string, detail?: unknown): void {
  if (!isDebug()) return
  const reason =
    detail instanceof Error
      ? detail.message
      : detail === undefined
        ? ''
        : ` ${JSON.stringify(detail).slice(0, 300)}`
  humanWarn(`[browser] Firefox new-tab courtesy: ${step}${reason}`)
}

export interface ManagerTabClient {
  request: (payload: unknown) => Promise<unknown>
  evaluate: (actor: string, expression: string) => Promise<unknown>
  on: (event: string, listener: (message: unknown) => void) => unknown
  off?: (event: string, listener: (message: unknown) => void) => unknown
  removeListener?: (
    event: string,
    listener: (message: unknown) => void
  ) => unknown
}

type AddonEntry = {
  actor?: string
  id?: string
  consoleActor?: string
}

type TargetForm = {
  actor?: string
  consoleActor?: string
  url?: string
}

type TargetEvent = {
  type?: string
  target?: TargetForm
}

async function findManagerAddon(
  client: ManagerTabClient
): Promise<AddonEntry | undefined> {
  const reply = (await client.request({to: 'root', type: 'listAddons'})) as {
    addons?: AddonEntry[]
  }
  return (reply?.addons || []).find((addon) => addon?.id === MANAGER_ADDON_ID)
}

function unsubscribe(
  client: ManagerTabClient,
  listener: (message: unknown) => void
) {
  if (typeof client.off === 'function') client.off('message', listener)
  else client.removeListener?.('message', listener)
}

function isBackgroundPage(target: TargetForm | undefined): boolean {
  return /_generated_background_page\.html|\/background/.test(
    String(target?.url || '')
  )
}

// A web-extension descriptor exposes no target of its own; the watcher it
// hands out announces the add-on's documents, and the background page is
// the one whose console can run tabs.create. The targets live only while
// the watch does, so the caller releases it after using the actor.
async function resolveConsoleActorViaWatcher(
  client: ManagerTabClient,
  descriptorActor: string
): Promise<{consoleActor?: string; release: () => void}> {
  const watcher = (await client.request({
    to: descriptorActor,
    type: 'getWatcher',
    isServerTargetSwitchingEnabled: true
  })) as {actor?: string}
  const noop = () => {}
  if (!watcher?.actor) return {release: noop}
  const watcherActor = watcher.actor

  const release = () => {
    client
      .request({to: watcherActor, type: 'unwatchTargets', targetType: 'frame'})
      .catch(() => {
        // Ignore
      })
  }

  const targets: TargetForm[] = []
  const collect = (message: unknown) => {
    const event = message as TargetEvent
    if (event?.type === 'target-available-form' && event.target) {
      targets.push(event.target)
    }
  }
  client.on('message', collect)
  try {
    // The first announcement can arrive as the reply itself.
    collect(
      await client.request({
        to: watcherActor,
        type: 'watchTargets',
        targetType: 'frame'
      })
    )
    const deadline = Date.now() + TARGET_WAIT_MS
    while (Date.now() < deadline) {
      const background = targets.find(
        (target) => target.consoleActor && isBackgroundPage(target)
      )
      if (background) return {consoleActor: background.consoleActor, release}
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return {
      consoleActor: targets.find((target) => target.consoleActor)?.consoleActor,
      release
    }
  } finally {
    unsubscribe(client, collect)
  }
}

async function resolveConsoleActor(
  client: ManagerTabClient,
  addon: AddonEntry
): Promise<{consoleActor?: string; release: () => void}> {
  if (addon.consoleActor) {
    return {consoleActor: addon.consoleActor, release: () => {}}
  }
  if (!addon.actor) return {release: () => {}}
  return await resolveConsoleActorViaWatcher(client, addon.actor)
}

// Asks the manager add-on to open a new tab. False when the add-on cannot be
// reached, so the caller can report it; never throws.
export async function openManagerNewTab(
  client: ManagerTabClient
): Promise<boolean> {
  try {
    const addon = await findManagerAddon(client)
    if (!addon) {
      reportStep('manager add-on not listed')
      return false
    }
    const {consoleActor, release} = await resolveConsoleActor(client, addon)
    if (!consoleActor) {
      release()
      reportStep('no console actor for the manager background page')
      return false
    }
    try {
      const result = await client.evaluate(
        consoleActor,
        OPEN_NEW_TAB_EXPRESSION
      )
      reportStep('tabs.create evaluated', result)
    } finally {
      release()
    }
    return true
  } catch (error) {
    reportStep('failed', error)
    return false
  }
}
