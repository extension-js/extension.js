// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {
  accessibilityProbeScript,
  cancelPromptScript,
  closeSettingsScript,
  extensionCheckboxId,
  extensionEnabledScript,
  OTHER_WEBSITES_ALLOW,
  otherWebsitesScript,
  parseCommandShortcut,
  pressShortcutScript,
  readShortcutScript,
  safariAlertScript,
  safariRunningScript,
  shortcutFromGlyphs,
  toolbarButtonId,
  toolbarButtonScript,
  toolbarMenuScript,
  unsignedExtensionsScript
} from './scripts'
import {
  appexPathFor,
  createSafariUiTools,
  isAccessibilityRefusal,
  parseScriptAnswer,
  type SafariUiTools,
  type ScriptAnswer
} from './tools'

export {
  extensionCheckboxId,
  parseCommandShortcut,
  shortcutFromGlyphs,
  toolbarButtonId
} from './scripts'
export {
  appexPathFor,
  createSafariUiTools,
  hostAppName,
  isAccessibilityRefusal,
  parseScriptAnswer,
  type SafariUiTools
} from './tools'

export type SafariUiFailureKind =
  | 'platform'
  | 'accessibility'
  | 'script'
  | 'not-found'
  | 'not-running'

export class SafariUiError extends Error {
  kind: SafariUiFailureKind
  host?: string

  constructor(kind: SafariUiFailureKind, message: string, host?: string) {
    super(message)
    this.name = 'SafariUiError'
    this.kind = kind
    this.host = host
  }
}

export interface SafariExtensionTarget {
  bundleId: string
  developmentTeam?: string
}

export interface AccessibilityCheck {
  granted: boolean
  host: string
  detail?: string
}

export async function checkAccessibility(
  tools: SafariUiTools
): Promise<AccessibilityCheck> {
  const host = tools.hostApp()

  if (tools.platform !== 'darwin') {
    return {granted: false, host, detail: `platform ${tools.platform}`}
  }

  const result = await tools.runScript(accessibilityProbeScript())
  const answer = parseScriptAnswer(result.output)

  if (result.ok && answer?.ok) return {granted: true, host}

  const detail = String(answer?.error || result.output || '').trim()

  return {granted: false, host, detail}
}

async function runAnswer(
  tools: SafariUiTools,
  source: string
): Promise<ScriptAnswer> {
  const result = await tools.runScript(source)
  const answer = parseScriptAnswer(result.output)

  if (result.ok && answer?.ok) return answer

  const detail = String(answer?.error || result.output || '').trim()

  if (isAccessibilityRefusal(detail)) {
    throw new SafariUiError(
      'accessibility',
      `Safari's UI can't be read without an Accessibility grant: ${detail}`,
      tools.hostApp()
    )
  }

  throw new SafariUiError('script', detail || 'the Safari UI script failed')
}

export interface EnableStep {
  step: 'safari' | 'unsigned' | 'pluginkit' | 'enabled' | 'websites'
  before: string | null
  after: string | null
  changed: boolean
  ok: boolean
  detail?: string
}

export interface EnableReport {
  enabled: boolean
  listed: boolean
  otherWebsites: string | null
  steps: EnableStep[]
  reason?: string
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null

  return String(value)
}

export interface EnableInput {
  target: SafariExtensionTarget
  appPath: string
  tools?: SafariUiTools
  onStep?: (step: EnableStep) => void
  onPromptWait?: (step: 'unsigned' | 'enabled', seconds: number) => void
  startWaitMs?: number
  promptWaitMs?: number
  promptPollMs?: number
}

const SAFARI_START_MS = 20_000
const SAFARI_START_POLL_MS = 250

async function safariRunning(tools: SafariUiTools): Promise<boolean> {
  return Boolean((await runAnswer(tools, safariRunningScript())).running)
}

async function ensureSafariRunning(
  tools: SafariUiTools,
  waitMs: number
): Promise<EnableStep | null> {
  if (await safariRunning(tools)) return null

  const launched = await tools.launchSafari()

  if (!launched.ok) {
    throw new SafariUiError(
      'not-running',
      `Safari is not running and could not be started: ${launched.output.trim() || `open answered exit ${launched.code}`}`
    )
  }

  const deadline = Date.now() + waitMs

  while (Date.now() < deadline) {
    if (await safariRunning(tools)) {
      return {
        step: 'safari',
        before: 'not running',
        after: 'running',
        changed: true,
        ok: true
      }
    }

    await new Promise((resolve) => setTimeout(resolve, SAFARI_START_POLL_MS))
  }

  throw new SafariUiError(
    'not-running',
    `Safari is not running: it was started in the background and System Events still listed no Safari process ${Number((waitMs / 1000).toFixed(1))} s later`
  )
}

function unsignedBlockedReason(blocker: unknown, waitedMs: number): string {
  const where = 'Safari > Settings > Developer > Allow unsigned extensions'

  return typeof blocker === 'string' && blocker
    ? `${where} still reads off ${Number((waitedMs / 1000).toFixed(1))} s after the click, and ${blocker}: answer it in Safari, then run again`
    : `${where} still reads off ${Number((waitedMs / 1000).toFixed(1))} s after the click: Safari asks for Touch ID or the password before it turns this on, and this run cannot answer that. Answer it or turn the box on by hand, then run again`
}

const UNSIGNED_WAIT_MS = 60_000
const UNSIGNED_POLL_MS = 1000

// Safari keeps a scripted click only after the person answers its Touch ID
// or password prompt, so the control is read again until the wait ends.
async function waitForOn(
  tools: SafariUiTools,
  script: string,
  waitMs: number,
  pollMs: number
): Promise<boolean> {
  const deadline = Date.now() + waitMs

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs))

    try {
      const read = await runAnswer(tools, script)

      if (asText(read.after) === '1') return true
    } catch {
      // A read held behind the prompt is tried again until the wait ends
    }
  }

  return false
}

const PROMPT_CANCELED =
  'Nobody answered, so this run canceled the prompt and Safari is not held behind it'

// Never throws: a prompt this run raised and nobody answered is canceled, so
// it does not hold the steps and the WebDriver request that follow.
async function cancelPrompt(tools: SafariUiTools): Promise<boolean> {
  try {
    const answer = await runAnswer(tools, cancelPromptScript())

    return Number(answer.canceled) > 0
  } catch {
    return false
  }
}

export function alertReason(alert: SafariAlert): string {
  const buttons =
    alert.buttons.length > 0 ? `, buttons ${alert.buttons.join(', ')}` : ''

  return `Safari shows an alert that waits for an answer ("${alert.text || 'no text'}"${buttons}), and it holds every step behind it: answer it in Safari, then run again`
}

export interface SafariAlert {
  text: string
  buttons: string[]
}

// Never throws: a read that fails says nothing about an alert.
export async function readSafariAlert(
  tools: SafariUiTools = createSafariUiTools()
): Promise<SafariAlert | null> {
  try {
    if (tools.platform !== 'darwin') return null

    const answer = await runAnswer(tools, safariAlertScript())
    const alert = answer.alert as Record<string, unknown> | null | undefined

    if (!alert || typeof alert !== 'object') return null

    return {
      text: String(alert.text || ''),
      buttons: Array.isArray(alert.buttons) ? alert.buttons.map(String) : []
    }
  } catch {
    return null
  }
}

// Safari 26 kept a scripted click on a team-signed row and dropped the same
// click on an UNSIGNED row, so an ad-hoc build is told both ways out.
function switchDroppedReason(
  checkboxId: string,
  adHoc: boolean,
  blocker: unknown,
  waitedMs: number
): string {
  const read = `Safari read the switch for ${checkboxId} off again after the script turned it on`

  // Safari 27 flags the scripted click and asks the person to confirm it.
  if (typeof blocker === 'string' && blocker) {
    const signed = adHoc
      ? ', or set browser.safari.developmentTeam in extension.config.js so the build is signed'
      : ''

    return `Safari read the switch for ${checkboxId} off ${Number((waitedMs / 1000).toFixed(1))} s after the script clicked it, and ${blocker}: answer it in Safari or turn the switch on by hand in Safari > Settings > Extensions${signed}, then run again`
  }

  return adHoc
    ? `${read}: an unsigned row drops a scripted switch that a team-signed row keeps, so turn it on by hand in Safari > Settings > Extensions, or set browser.safari.developmentTeam in extension.config.js so the build is signed and the switch sticks`
    : `${read}: turn it on by hand in Safari > Settings > Extensions, then run again`
}

export async function closeSafariSettings(
  tools: SafariUiTools = createSafariUiTools()
): Promise<string | null> {
  const answer = await runAnswer(tools, closeSettingsScript())

  return typeof answer.blocker === 'string' && answer.blocker
    ? answer.blocker
    : null
}

export async function enableSafariExtension(
  input: EnableInput
): Promise<EnableReport> {
  const tools = input.tools || createSafariUiTools()
  const {bundleId, developmentTeam} = input.target
  const checkboxId = extensionCheckboxId(bundleId, developmentTeam)
  const steps: EnableStep[] = []

  const record = (step: EnableStep) => {
    steps.push(step)
    input.onStep?.(step)
  }

  if (tools.platform !== 'darwin') {
    throw new SafariUiError(
      'platform',
      `Safari's UI can be driven on macOS only, this is ${tools.platform}.`
    )
  }

  const started = await ensureSafariRunning(
    tools,
    input.startWaitMs ?? SAFARI_START_MS
  )

  if (started) record(started)

  const alert = await readSafariAlert(tools)

  if (alert) {
    return {
      enabled: false,
      listed: false,
      otherWebsites: null,
      steps,
      reason: alertReason(alert)
    }
  }

  const adHoc = !String(developmentTeam || '').trim()
  const current = await runAnswer(
    tools,
    extensionEnabledScript(checkboxId, 'read')
  )
  const alreadyOn = Boolean(current.listed) && asText(current.after) === '1'

  if (alreadyOn) {
    record({
      step: 'enabled',
      before: '1',
      after: '1',
      changed: false,
      ok: true,
      detail: checkboxId
    })
  } else {
    if (adHoc) {
      const unsigned = await runAnswer(tools, unsignedExtensionsScript('on'))
      const waitMs = input.promptWaitMs ?? UNSIGNED_WAIT_MS
      let unsignedOn = asText(unsigned.after) === '1'
      let waitedMs = 0

      if (!unsignedOn && unsigned.clicked && waitMs > 0) {
        input.onPromptWait?.('unsigned', Number((waitMs / 1000).toFixed(1)))
        unsignedOn = await waitForOn(
          tools,
          unsignedExtensionsScript('read'),
          waitMs,
          input.promptPollMs ?? UNSIGNED_POLL_MS
        )

        waitedMs = waitMs
      }

      record({
        step: 'unsigned',
        before: asText(unsigned.before),
        after: unsignedOn ? '1' : asText(unsigned.after),
        changed: Boolean(unsigned.clicked),
        ok: unsignedOn
      })

      if (!unsignedOn) {
        const canceled = waitedMs > 0 && (await cancelPrompt(tools))
        const reason = unsignedBlockedReason(unsigned.blocker, waitedMs)

        return {
          enabled: false,
          listed: false,
          otherWebsites: null,
          steps,
          reason: canceled ? `${reason}. ${PROMPT_CANCELED}` : reason
        }
      }
    }

    const appex = appexPathFor(input.appPath)

    if (!appex) {
      throw new SafariUiError(
        'not-found',
        `No .appex under ${input.appPath}/Contents/PlugIns to register with pluginkit.`
      )
    }

    const registered = await tools.pluginkitAdd(appex)
    record({
      step: 'pluginkit',
      before: null,
      after: registered.ok ? 'registered' : 'failed',
      changed: registered.ok,
      ok: registered.ok,
      detail: registered.ok ? appex : registered.output.trim()
    })

    const enabled = await runAnswer(
      tools,
      extensionEnabledScript(checkboxId, 'on')
    )
    const listed = Boolean(enabled.listed)
    const switchWaitMs = input.promptWaitMs ?? UNSIGNED_WAIT_MS
    let switchOn = listed && asText(enabled.after) === '1'
    let switchWaitedMs = 0

    if (listed && !switchOn && enabled.clicked && switchWaitMs > 0) {
      input.onPromptWait?.('enabled', Number((switchWaitMs / 1000).toFixed(1)))
      switchOn = await waitForOn(
        tools,
        extensionEnabledScript(checkboxId, 'read'),
        switchWaitMs,
        input.promptPollMs ?? UNSIGNED_POLL_MS
      )

      switchWaitedMs = switchWaitMs
    }

    record({
      step: 'enabled',
      before: asText(enabled.before),
      after: switchOn ? '1' : asText(enabled.after),
      changed: Boolean(enabled.clicked),
      ok: switchOn,
      detail: listed ? checkboxId : `${checkboxId} is not listed`
    })

    if (!switchOn) {
      const dropped = listed && Boolean(enabled.clicked)
      const canceled = switchWaitedMs > 0 && (await cancelPrompt(tools))
      const tail = canceled ? `. ${PROMPT_CANCELED}` : ''

      return {
        enabled: false,
        listed,
        otherWebsites: null,
        steps,
        ...(dropped
          ? {
              reason: `${switchDroppedReason(
                checkboxId,
                adHoc,
                enabled.blocker,
                switchWaitedMs
              )}${tail}`
            }
          : {})
      }
    }
  }

  const websites = await runAnswer(
    tools,
    otherWebsitesScript(checkboxId, 'allow')
  )
  record({
    step: 'websites',
    before: asText(websites.before),
    after: asText(websites.after),
    changed: asText(websites.before) !== asText(websites.after),
    ok: asText(websites.after) === OTHER_WEBSITES_ALLOW
  })

  return {
    enabled: true,
    listed: true,
    otherWebsites: asText(websites.after),
    steps
  }
}

export interface EnabledState {
  listed: boolean
  enabled: boolean | null
}

export async function readSafariExtensionEnabled(
  target: SafariExtensionTarget,
  tools: SafariUiTools = createSafariUiTools()
): Promise<EnabledState> {
  const checkboxId = extensionCheckboxId(
    target.bundleId,
    target.developmentTeam
  )
  const answer = await runAnswer(
    tools,
    extensionEnabledScript(checkboxId, 'read')
  )

  return {
    listed: Boolean(answer.listed),
    enabled: answer.listed ? asText(answer.after) === '1' : null
  }
}

export async function setSafariExtensionEnabled(
  target: SafariExtensionTarget,
  on: boolean,
  tools: SafariUiTools = createSafariUiTools()
): Promise<EnabledState> {
  const checkboxId = extensionCheckboxId(
    target.bundleId,
    target.developmentTeam
  )
  const answer = await runAnswer(
    tools,
    extensionEnabledScript(checkboxId, on ? 'on' : 'off')
  )

  return {
    listed: Boolean(answer.listed),
    enabled: answer.listed ? asText(answer.after) === '1' : null
  }
}

export interface ToolbarButtonReading {
  found: boolean
  id: string
  title: string | null
  tooltip: string | null
  badge: string | null
  enabled: boolean | null
}

export async function readToolbarButton(
  target: SafariExtensionTarget,
  tools: SafariUiTools = createSafariUiTools()
): Promise<ToolbarButtonReading> {
  const id = toolbarButtonId(target.bundleId, target.developmentTeam)
  const answer = await runAnswer(tools, toolbarButtonScript(id))
  const button = (answer.button || {}) as Record<string, unknown>

  return {
    found: Boolean(answer.found),
    id,
    title: asText(button.title),
    tooltip: asText(button.tooltip),
    badge: asText(button.badge),
    enabled:
      typeof button.enabled === 'boolean' ? (button.enabled as boolean) : null
  }
}

export interface ToolbarMenuReading {
  found: boolean
  opened: boolean
  id: string
  items: Array<{title: string; enabled: boolean}>
}

export async function readToolbarMenu(
  target: SafariExtensionTarget,
  tools: SafariUiTools = createSafariUiTools()
): Promise<ToolbarMenuReading> {
  const id = toolbarButtonId(target.bundleId, target.developmentTeam)
  const answer = await runAnswer(tools, toolbarMenuScript(id))
  const items = Array.isArray(answer.items)
    ? (answer.items as Array<Record<string, unknown>>).map((item) => ({
        title: String(item.title || ''),
        enabled: Boolean(item.enabled)
      }))
    : []

  return {
    found: Boolean(answer.found),
    opened: Boolean(answer.opened),
    id,
    items
  }
}

export interface ShortcutPress {
  shortcut: string
  key: string
  modifiers: string[]
}

export async function pressShortcut(
  shortcut: string,
  tools: SafariUiTools = createSafariUiTools()
): Promise<ShortcutPress> {
  const parsed = parseCommandShortcut(shortcut)
  await runAnswer(tools, pressShortcutScript(parsed))

  return {shortcut, key: parsed.key, modifiers: parsed.modifiers}
}

export interface ShortcutReading {
  listed: boolean
  shown: string | null
  shortcut: string | null
}

export async function readShortcut(
  target: SafariExtensionTarget,
  tools: SafariUiTools = createSafariUiTools()
): Promise<ShortcutReading> {
  const checkboxId = extensionCheckboxId(
    target.bundleId,
    target.developmentTeam
  )
  const answer = await runAnswer(tools, readShortcutScript(checkboxId))
  const shown = asText(answer.shortcut)

  return {
    listed: Boolean(answer.listed),
    shown,
    shortcut: shown ? shortcutFromGlyphs(shown) : null
  }
}
