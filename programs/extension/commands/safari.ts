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
import * as browserMessages from '../browsers/browsers-lib/messages'
import type {CompilationLike} from '../browsers/browsers-types'
import {
  builtAppPath,
  resolveSafariBuildConfig
} from '../browsers/run-safari/safari-launch/safari-config'
import {
  checkAccessibility,
  createSafariUiTools,
  type EnableStep,
  enableSafariExtension,
  pressShortcut,
  readShortcut,
  readToolbarButton,
  readToolbarMenu,
  SafariUiError,
  type SafariUiTools
} from '../browsers/run-safari/safari-ui'
import {exitAfterDrain, exitWithFailure} from '../helpers/exit-after-drain'
import {loadExtensionDevelopBridgeModule} from '../helpers/extension-develop-runtime'
import * as messages from '../helpers/messages'
import {CODES, ENVELOPE, type ErrorCode, humanLine} from '../helpers/messaging'
import {normalizeOutputFormat} from '../helpers/output-flag'
import {resolveSessionProjectPath} from '../helpers/session-project-path'

export type SafariUiAction = (typeof messages.SAFARI_UI_ACTIONS)[number]

interface SafariCommandOptions {
  output?: 'pretty' | 'json'
  bundleId?: string
  appName?: string
  developmentTeam?: string
  keys?: string
}

const COMMAND = 'safari'

let injectedTools: SafariUiTools | undefined

export function setSafariUiToolsForTests(tools?: SafariUiTools): void {
  injectedTools = tools
}

function writeFrame(frame: unknown): void {
  try {
    fs.writeSync(1, `${JSON.stringify(frame)}\n`)
  } catch {
    console.log(JSON.stringify(frame))
  }
}

function statusFor(code: ErrorCode): string {
  if (code === CODES.E_INVALID_OPTION || code === CODES.E_ARGS) return 'usage'
  if (code === CODES.E_ACCESSIBILITY_DENIED) return 'denied'
  if (code === CODES.E_TARGET_NOT_FOUND) return 'not-found'

  return 'failed'
}

function fail(
  output: string | undefined,
  human: string,
  code: ErrorCode,
  plain: string,
  hint?: string
): never {
  console.error(human)

  if (normalizeOutputFormat(output) === 'json') {
    writeFrame(
      ENVELOPE.fail(
        COMMAND,
        statusFor(code),
        {code, message: plain, name: 'CliError'},
        {browser: 'safari', ...(hint ? {hint} : {})}
      )
    )
  }

  exitWithFailure(code)
}

function accessibilityHint(host: string): string {
  return `Open System Settings ▸ Privacy & Security ▸ Accessibility, add ${host}, and run again.`
}

function manifestDirFor(projectPath: string): string {
  const candidates = [
    path.join(projectPath, 'dist', 'safari'),
    projectPath,
    path.join(projectPath, 'src')
  ]

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir
  }

  return candidates[0]
}

function readManifestCommands(manifestDir: string): string | undefined {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(manifestDir, 'manifest.json'), 'utf8')
    ) as {commands?: Record<string, {suggested_key?: Record<string, string>}>}
    const commands = manifest.commands || {}
    const names = Object.keys(commands)
    const preferred = names.includes('_execute_action')
      ? '_execute_action'
      : names[0]
    if (!preferred) return undefined

    const keys = commands[preferred]?.suggested_key || {}

    return keys.mac || keys.default
  } catch {
    return undefined
  }
}

export function toolsForRun(): SafariUiTools {
  return injectedTools || createSafariUiTools()
}

export interface ResolvedSafariTarget {
  projectPath: string
  manifestDir: string
  appName: string
  bundleId: string
  developmentTeam?: string
  appPath: string
}

export async function resolveSafariTarget(
  projectPathArg: string | undefined,
  opts: SafariCommandOptions
): Promise<ResolvedSafariTarget> {
  const bridge = await loadExtensionDevelopBridgeModule()
  const projectPath = resolveSessionProjectPath(bridge, projectPathArg)
  const manifestDir = manifestDirFor(projectPath)
  const compilation = {
    options: {output: {path: manifestDir}}
  } as unknown as CompilationLike
  const config = resolveSafariBuildConfig(compilation, {
    extension: [manifestDir],
    browser: 'safari',
    appName: opts.appName,
    bundleId: opts.bundleId,
    developmentTeam: opts.developmentTeam
  })

  let bundleId = config.bundleIdentifier

  if (!opts.bundleId) {
    try {
      const ready = bridge?.readReadyContract?.(projectPath, 'safari') as
        | {extensionId?: unknown}
        | null
        | undefined
      const extensionId = String(ready?.extensionId || '')

      if (extensionId.endsWith('.Extension')) {
        bundleId = extensionId.slice(0, -'.Extension'.length)
      }
    } catch {
      bundleId = config.bundleIdentifier
    }
  }

  return {
    projectPath,
    manifestDir,
    appName: config.appName,
    bundleId,
    developmentTeam: config.developmentTeam,
    appPath: builtAppPath(config)
  }
}

const STEP_LABELS: Record<EnableStep['step'], string> = {
  unsigned: 'unsigned extensions',
  pluginkit: 'pluginkit registration',
  enabled: 'extension switch',
  websites: 'other websites'
}

function switchWord(value: string | null): string {
  if (value === '1') return 'on'
  if (value === '0') return 'off'

  return value ?? 'nothing'
}

async function runAction(
  action: SafariUiAction,
  projectPathArg: string | undefined,
  opts: SafariCommandOptions
): Promise<unknown> {
  const tools = toolsForRun()

  if (tools.platform !== 'darwin') {
    fail(
      opts.output,
      messages.safariUiMacOnly(tools.platform),
      CODES.E_SAFARI_TOOLCHAIN,
      `Safari's own UI can be read on macOS only, this is ${tools.platform}.`
    )
  }

  const access = await checkAccessibility(tools)

  if (!access.granted) {
    fail(
      opts.output,
      browserMessages.safariAccessibilityDenied(access.host),
      CODES.E_ACCESSIBILITY_DENIED,
      `macOS has not granted ${access.host} Accessibility, so Safari's own UI can't be read.`,
      accessibilityHint(access.host)
    )
  }

  const target = await resolveSafariTarget(projectPathArg, opts)
  const identity = {
    bundleId: target.bundleId,
    developmentTeam: target.developmentTeam
  }

  if (action === 'enable') {
    if (!fs.existsSync(target.appPath)) {
      fail(
        opts.output,
        messages.safariUiNoBuiltApp(target.appPath),
        CODES.E_TARGET_NOT_FOUND,
        `No Safari app to enable at ${target.appPath}.`,
        'Run extension dev --browser safari or extension build --browser safari first.'
      )
    }

    const report = await enableSafariExtension({
      target: identity,
      appPath: target.appPath,
      tools,
      onStep: (step) => {
        if (normalizeOutputFormat(opts.output) === 'json') return

        humanLine(
          messages.safariUiStep(
            STEP_LABELS[step.step],
            step.before === null
              ? `read back ${switchWord(step.after)}`
              : `read ${switchWord(step.before)} → ${switchWord(step.after)}`
          )
        )
      }
    })

    return {
      appName: target.appName,
      bundleId: target.bundleId,
      enabled: report.enabled,
      listed: report.listed,
      otherWebsites: report.otherWebsites,
      steps: report.steps
    }
  }

  if (action === 'button') {
    const button = await readToolbarButton(identity, tools)

    if (!button.found) {
      fail(
        opts.output,
        messages.safariUiButtonMissing(button.id),
        CODES.E_TARGET_NOT_FOUND,
        `Safari's toolbar has no button ${button.id}.`,
        'Turn the extension on in Safari Settings, Extensions, then run again.'
      )
    }

    return {appName: target.appName, bundleId: target.bundleId, ...button}
  }

  if (action === 'menu') {
    const menu = await readToolbarMenu(identity, tools)

    if (!menu.found) {
      fail(
        opts.output,
        messages.safariUiButtonMissing(menu.id),
        CODES.E_TARGET_NOT_FOUND,
        `Safari's toolbar has no button ${menu.id}.`,
        'Turn the extension on in Safari Settings, Extensions, then run again.'
      )
    }

    return {appName: target.appName, bundleId: target.bundleId, ...menu}
  }

  if (action === 'press') {
    const keys = opts.keys || readManifestCommands(target.manifestDir)

    if (!keys) {
      fail(
        opts.output,
        messages.safariUiNoShortcut(),
        CODES.E_INVALID_OPTION,
        'The manifest declares no commands shortcut to press.',
        'Pass --keys <shortcut>, for example --keys Alt+Shift+H.'
      )
    }

    const pressed = await pressShortcut(keys, tools)

    return {appName: target.appName, bundleId: target.bundleId, ...pressed}
  }

  const shortcut = await readShortcut(identity, tools)

  if (!shortcut.listed) {
    fail(
      opts.output,
      messages.safariUiNotListed(target.bundleId),
      CODES.E_TARGET_NOT_FOUND,
      `Safari does not list ${target.bundleId} in Settings, Extensions.`,
      'Run extension safari enable first.'
    )
  }

  return {appName: target.appName, bundleId: target.bundleId, ...shortcut}
}

export function registerSafariCommand(program: Command): void {
  program
    .command(COMMAND)
    .arguments('<action> [project-path]')
    .usage('<enable|button|menu|press|shortcut> [project-path] [options]')
    .description(messages.commandDescriptions.safari)
    .option(
      '--keys <shortcut>',
      'with press: the shortcut to send as the manifest writes it, for example Alt+Shift+H (default: the manifest commands entry)'
    )
    .option('--app-name <name>', 'the Safari app name when it was overridden')
    .option(
      '--bundle-id <reverse.dns>',
      'the Safari bundle identifier when it was overridden (default: the running session, else the derived id)'
    )
    .option(
      '--development-team <id>',
      'the Apple team id the app was signed with (default: an ad-hoc build)'
    )
    .option('--output <pretty|json>', 'output format (default pretty)')
    .action(
      async (
        action: string,
        projectPathArg: string | undefined,
        opts: SafariCommandOptions = {}
      ) => {
        const known = (
          messages.SAFARI_UI_ACTIONS as readonly string[]
        ).includes(action)

        if (!known) {
          fail(
            opts.output,
            messages.safariUiUnknownAction(action),
            CODES.E_INVALID_OPTION,
            `${action} is not a Safari action. Choose one of ${messages.SAFARI_UI_ACTIONS.join(', ')}.`
          )
        }

        let value: unknown

        try {
          value = await runAction(
            action as SafariUiAction,
            projectPathArg,
            opts
          )
        } catch (error) {
          if (
            error instanceof SafariUiError &&
            error.kind === 'accessibility'
          ) {
            const host = error.host || toolsForRun().hostApp()
            fail(
              opts.output,
              browserMessages.safariAccessibilityDenied(host),
              CODES.E_ACCESSIBILITY_DENIED,
              `macOS has not granted ${host} Accessibility, so Safari's own UI can't be read.`,
              accessibilityHint(host)
            )
          }

          const reason = error instanceof Error ? error.message : String(error)
          fail(
            opts.output,
            messages.safariUiFailed(reason),
            error instanceof SafariUiError && error.kind === 'not-found'
              ? CODES.E_TARGET_NOT_FOUND
              : CODES.E_SAFARI_UI,
            reason
          )
        }

        if (normalizeOutputFormat(opts.output) === 'json') {
          writeFrame(ENVELOPE.ok(COMMAND, 'ok', value, {browser: 'safari'}))
        } else {
          console.log(JSON.stringify(value, null, 2))
        }

        await exitAfterDrain(0)
      }
    )
}
