#!/usr/bin/env node

//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {program} from 'commander'
import checkUpdates from './helpers/check-updates'
import * as messages from './helpers/messages'
import {resolveExtensionDevelopVersion} from './helpers/extension-develop-runtime'
import {markCommandSuccess, markCommandFailure} from './helpers/telemetry-cli'
import {getCliPackageJson} from './helpers/cli-package-json'

import {registerCreateCommand} from './commands/create'
import {registerDevCommand} from './commands/dev'
import {registerStartCommand} from './commands/start'
import {registerPreviewCommand} from './commands/preview'
import {registerBuildCommand} from './commands/build'
import {registerInstallCommand} from './commands/install'
import {registerTelemetryCommand} from './commands/telemetry'

const cliPackageJson = getCliPackageJson()

function developVersion() {
  return resolveExtensionDevelopVersion(__dirname, cliPackageJson.version)
}

process.env.EXTENSION_DEVELOP_VERSION = developVersion()

function resolveAIHelpFormatFromArgv(argv: string[]): string {
  const equalArg = argv.find((arg) => arg.startsWith('--format='))
  if (equalArg) return equalArg.slice('--format='.length)

  const formatIndex = argv.indexOf('--format')
  if (formatIndex >= 0) return argv[formatIndex + 1] || ''

  return 'pretty'
}

function resolveCommandFromArgv(argv: string[]): string | undefined {
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('-')) return arg
  }
  return undefined
}

function applyNoBrowserArgvShim(argv: string[]): string[] {
  const hasNoRunner = argv.includes('--no-runner')
  if (hasNoRunner) {
    // eslint-disable-next-line no-console
    console.error(messages.removedNoRunnerFlag())
    process.exit(1)
  }

  let nextArgv = argv
  // --no-reload: dev-only. Skips the content-script reinjection wrapper +
  // the on-rebuild reload dispatch in plugin-browsers, so the dist bundle
  // stays clean and an open tab is not disturbed when files change. The
  // user is expected to manually reload the extension/page to pick up
  // changes. Implemented as an env var because plugin-web-extension and
  // plugin-browsers run in the develop process and don't see CLI flags
  // directly.
  const hasNoReload = nextArgv.includes('--no-reload')
  if (hasNoReload) {
    const command = resolveCommandFromArgv(nextArgv)
    if (command !== 'dev') {
      // eslint-disable-next-line no-console
      console.error(
        `--no-reload is only supported on \`extension dev\` (got: ${command || 'no command'}).`
      )
      process.exit(1)
    }
    process.env.EXTENSION_NO_RELOAD = 'true'
    nextArgv = nextArgv.filter((arg) => arg !== '--no-reload')
  }

  const hasNoBrowser = nextArgv.includes('--no-browser')
  if (!hasNoBrowser) return nextArgv

  const command = resolveCommandFromArgv(nextArgv)
  const supportsNoBrowser =
    command === 'dev' || command === 'start' || command === 'preview'

  if (!supportsNoBrowser) {
    // eslint-disable-next-line no-console
    console.error(messages.noBrowserNotSupportedForCommand(command))
    process.exit(1)
  }

  process.env.EXTENSION_CLI_NO_BROWSER = '1'
  return nextArgv.filter((arg) => arg !== '--no-browser')
}

const SOURCE_INSPECTION_FLAG_PREFIXES = [
  '--source',
  '--watch-source',
  '--no-source',
  '--no-watch-source'
] as const

function hasSourceInspectionFlag(argv: string[]): boolean {
  return argv.some((arg) => {
    if (typeof arg !== 'string') return false
    return SOURCE_INSPECTION_FLAG_PREFIXES.some(
      (prefix) =>
        arg === prefix ||
        arg.startsWith(`${prefix}=`) ||
        arg.startsWith(`${prefix}-`)
    )
  })
}

function guardSourceInspectionFlags(argv: string[]): void {
  const command = resolveCommandFromArgv(argv)

  if (command !== 'start' && command !== 'preview') return
  if (!hasSourceInspectionFlag(argv)) return

  // eslint-disable-next-line no-console
  console.error(messages.sourceInspectionNotSupported(command))
  process.exit(1)
}

function hasWaitFlag(argv: string[]): boolean {
  return argv.some(
    (arg) =>
      arg === '--wait' ||
      arg.startsWith('--wait=') ||
      arg === '--wait-timeout' ||
      arg.startsWith('--wait-timeout=') ||
      arg === '--wait-format' ||
      arg.startsWith('--wait-format=')
  )
}

function hasWaitModeEnabled(argv: string[]): boolean {
  // --wait takes an optional boolean; treat presence as on unless explicitly
  // set to false/0. --wait-timeout / --wait-format alone do not enable wait.
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--wait') {
      const next = argv[i + 1]
      if (next === 'false' || next === '0') return false
      return true
    }
    if (arg.startsWith('--wait=')) {
      const value = arg.slice('--wait='.length).toLowerCase()
      return value !== 'false' && value !== '0'
    }
  }
  return false
}

function guardSourceWithWaitOrNoBrowser(argv: string[]): void {
  const command = resolveCommandFromArgv(argv)
  if (command !== 'dev') return
  if (!hasSourceInspectionFlag(argv)) return

  if (process.env.EXTENSION_CLI_NO_BROWSER === '1') {
    // eslint-disable-next-line no-console
    console.error(messages.sourceIncompatibleWithNoBrowser())
    process.exit(1)
  }

  if (hasWaitFlag(argv) && hasWaitModeEnabled(argv)) {
    // eslint-disable-next-line no-console
    console.error(messages.sourceIncompatibleWithWait())
    process.exit(1)
  }
}

checkUpdates().then((updateMessage) => {
  if (!updateMessage) return

  if (process.env.EXTENSION_CLI_BANNER_PRINTED === 'true') {
    // eslint-disable-next-line no-console
    console.log(updateMessage.message)
    return
  }

  process.env.EXTENSION_CLI_UPDATE_SUFFIX = updateMessage.suffix
})

const extensionJs = program

extensionJs
  .name(cliPackageJson.name)
  .description(cliPackageJson.description)
  .version(cliPackageJson.version)
  .option('--no-telemetry', 'disable anonymous telemetry for this run')
  .option('--ai-help', 'show AI-assistant oriented help and tips')
  .option('--format <pretty|json>', 'output format for --ai-help', 'pretty')
  .addHelpText('after', messages.programUserHelp())
  .showHelpAfterError(true)
  .showSuggestionAfterError(true)

registerCreateCommand(extensionJs)
registerDevCommand(extensionJs)
registerStartCommand(extensionJs)
registerPreviewCommand(extensionJs)
registerBuildCommand(extensionJs)
registerInstallCommand(extensionJs)
registerTelemetryCommand(extensionJs)

extensionJs.on('option:ai-help', function () {
  const format = resolveAIHelpFormatFromArgv(process.argv).trim().toLowerCase()

  if (format === 'json') {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        messages.programAIHelpJSON(cliPackageJson.version),
        null,
        2
      )
    )
    process.exit(0)
  }

  if (format !== 'pretty') {
    // eslint-disable-next-line no-console
    console.error(messages.invalidAIHelpFormat(format))
    process.exit(1)
  }

  // eslint-disable-next-line no-console
  console.log(messages.programAIHelp())
  process.exit(0)
})

// Show help when invoked with no args (e.g., `npx extension`)
if (process.argv.length <= 2) {
  extensionJs.outputHelp()
  process.exit(0)
}

const argv = applyNoBrowserArgvShim(process.argv)
guardSourceInspectionFlags(argv)
guardSourceWithWaitOrNoBrowser(argv)

extensionJs
  .parseAsync(argv)
  .then(() => {
    markCommandSuccess()
  })
  .catch((err: unknown) => {
    markCommandFailure()
    // eslint-disable-next-line no-console
    console.error(messages.unhandledError(err))
    process.exit(1)
  })
