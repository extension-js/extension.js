#!/usr/bin/env node

//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Must be the first import: exits with a version message on Node < 22.12,
// where requiring the ESM-only commander would crash with ERR_REQUIRE_ESM.
import './helpers/node-version-guard'
import {Option, program} from 'commander'
import {registerActCommands} from './commands/act'
import {registerBuildCommand} from './commands/build'
import {registerCreateCommand} from './commands/create'
import {registerDevCommand} from './commands/dev'
import {registerDoctorCommand} from './commands/doctor'
import {registerInstallCommand} from './commands/install'
import {registerLogsCommand} from './commands/logs'
import {registerPreviewCommand} from './commands/preview'
import {registerPublishCommand} from './commands/publish'
import {registerStartCommand} from './commands/start'
import {registerTelemetryCommand} from './commands/telemetry'
import checkUpdates from './helpers/check-updates'
import {getCliPackageJson} from './helpers/cli-package-json'
import {exitAfterDrain} from './helpers/exit-after-drain'
import {resolveExtensionDevelopVersion} from './helpers/extension-develop-runtime'
import * as messages from './helpers/messages'
import {warnDeprecatedOutputAlias} from './helpers/output-flag'
import {markCommandFailure, markCommandSuccess} from './helpers/telemetry-cli'

// Public type surface for extension.config.js, re-exported from the root. The
// .js extension is required for node16/nodenext resolution (TS2834).
export type {
  BrowserConfig,
  BrowserType,
  CompanionExtensionsConfig,
  FileConfig
} from './config-types.js'

const cliPackageJson = getCliPackageJson()

function developVersion() {
  return resolveExtensionDevelopVersion(__dirname, cliPackageJson.version)
}

process.env.EXTENSION_DEVELOP_VERSION = developVersion()

function scanArgvValue(argv: string[], flag: string): string | undefined {
  const equalArg = argv.find((arg) => arg.startsWith(`${flag}=`))
  if (equalArg) return equalArg.slice(flag.length + 1)

  const flagIndex = argv.indexOf(flag)
  if (flagIndex >= 0) return argv[flagIndex + 1] || ''

  return undefined
}

// --ai-help bypasses commander, so the deprecated --format alias has to be
// honored by this raw scan too, not only by the registered Option.
function resolveAIHelpFormatFromArgv(argv: string[]): string {
  const direct = scanArgvValue(argv, '--output')
  if (direct !== undefined) return direct

  const alias = scanArgvValue(argv, '--format')
  if (alias !== undefined) {
    warnDeprecatedOutputAlias('--format')
    return alias
  }

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
  // --no-reload: dev-only; skips the reinjection wrapper + reload dispatch so an
  // open tab is undisturbed. Env var because plugins don't see CLI flags.
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

checkUpdates().then((updateMessage) => {
  if (!updateMessage) return

  if (process.env.EXTENSION_CLI_BANNER_PRINTED === 'true') {
    // stderr, not stdout: this resolves asynchronously and would otherwise
    // land at an arbitrary point inside a `--output json` result.
    // eslint-disable-next-line no-console
    console.error(updateMessage.message)
    return
  }

  process.env.EXTENSION_CLI_UPDATE_SUFFIX = updateMessage.suffix
})

const extensionJs = program

extensionJs
  .name(String(cliPackageJson.name))
  .description(String(cliPackageJson.description))
  .version(String(cliPackageJson.version))
  .option('--no-telemetry', 'disable anonymous telemetry for this run')
  .option('--ai-help', 'show AI-assistant oriented help and tips')
  .addOption(
    // Deprecated alias of --output, --ai-help only. A visible root --output
    // would swallow every subcommand's own --output, so commander never
    // declares the canonical name here; the --ai-help argv scan resolves it.
    new Option('--format <pretty|json>').hideHelp()
  )
  .addHelpText('after', messages.programUserHelp())
  .showHelpAfterError(true)
  .showSuggestionAfterError(true)

registerCreateCommand(extensionJs)
registerDevCommand(extensionJs)
registerStartCommand(extensionJs)
registerPreviewCommand(extensionJs)
registerBuildCommand(extensionJs)
registerLogsCommand(extensionJs)
registerActCommands(extensionJs)
registerPublishCommand(extensionJs)
registerInstallCommand(extensionJs)
registerTelemetryCommand(extensionJs)
registerDoctorCommand(extensionJs)

// Handled before commander parses: the JSON frame can outgrow one pipe
// buffer, so the exit must wait for stdout to drain (#79).
function runAIHelp(): void {
  const format = resolveAIHelpFormatFromArgv(process.argv).trim().toLowerCase()

  if (format === 'json') {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        messages.programAIHelpJSON(String(cliPackageJson.version)),
        null,
        2
      )
    )
    void exitAfterDrain(0)
    return
  }

  if (format !== 'pretty') {
    // eslint-disable-next-line no-console
    console.error(messages.invalidAIHelpFormat(format))
    void exitAfterDrain(1)
    return
  }

  // eslint-disable-next-line no-console
  console.log(messages.programAIHelp())
  void exitAfterDrain(0)
}

if (process.argv.length <= 2) {
  extensionJs.outputHelp()
  process.exit(0)
}

if (process.argv.includes('--ai-help')) {
  runAIHelp()
} else {
  const argv = applyNoBrowserArgvShim(process.argv)

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
}
