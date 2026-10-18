// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {
  accessibilityProbeScript,
  extensionCheckboxId,
  extensionEnabledScript,
  OTHER_WEBSITES_ALLOW,
  otherWebsitesScript,
  parseCommandShortcut,
  pressShortcutScript,
  readShortcutScript,
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
  step: 'unsigned' | 'pluginkit' | 'enabled' | 'websites'
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
      record({
        step: 'unsigned',
        before: asText(unsigned.before),
        after: asText(unsigned.after),
        changed: Boolean(unsigned.clicked),
        ok: asText(unsigned.after) === '1'
      })
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
    record({
      step: 'enabled',
      before: asText(enabled.before),
      after: asText(enabled.after),
      changed: Boolean(enabled.clicked),
      ok: listed && asText(enabled.after) === '1',
      detail: listed ? checkboxId : `${checkboxId} is not listed`
    })

    if (!listed || asText(enabled.after) !== '1') {
      return {
        enabled: false,
        listed,
        otherWebsites: null,
        steps
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
