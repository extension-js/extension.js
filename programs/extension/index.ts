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
import {registerCapabilitiesCommand} from './commands/capabilities'
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
import {
  commanderErrorEnvelope,
  commanderExitCode,
  commanderHumanError,
  earlyExitEnvelope,
  internalErrorEnvelope,
  isCommanderError,
  isErrorFramed,
  wantsJsonOutput,
  writeStdoutFrame
} from './helpers/cli-failure'
import {getCliPackageJson} from './helpers/cli-package-json'
import {exitAfterDrain} from './helpers/exit-after-drain'
import {resolveExtensionDevelopVersion} from './helpers/extension-develop-runtime'
import * as messages from './helpers/messages'
import {CODES} from './helpers/messaging'
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

// A pre-parse refusal must still leave one machine frame on stdout when the
// caller asked for json, or the exit code arrives with nothing explaining it.
function failBeforeParse(
  argv: string[],
  humanMessage: string,
  code: (typeof CODES)[keyof typeof CODES],
  plainMessage: string,
  flag: string
): never {
  // eslint-disable-next-line no-console
  console.error(humanMessage)
  if (wantsJsonOutput(argv)) {
    writeStdoutFrame(
      earlyExitEnvelope(
        resolveCommandFromArgv(argv) || 'extension',
        code,
        plainMessage,
        {flag}
      )
    )
  }
  process.exit(1)
}

// --format is a deprecated alias of --output. Only the root program declares
// it (for --ai-help), so on a subcommand commander accepted it and nobody read
// it: the run printed human output while the caller waited for an envelope.
// Rewriting it here keeps one code path for every command instead of eleven.
function applyOutputAliasArgvShim(argv: string[]): string[] {
  const index = argv.findIndex(
    (arg) => arg === '--format' || arg.startsWith('--format=')
  )
  if (index < 0) return argv
  // --ai-help resolves the alias itself, and it never reaches a subcommand.
  if (argv.includes('--ai-help')) return argv

  const next = [...argv]
  if (next[index].startsWith('--format=')) {
    next[index] = `--output=${next[index].slice('--format='.length)}`
  } else {
    next[index] = '--output'
  }

  warnDeprecatedOutputAlias('--format')
  return next
}

function applyNoBrowserArgvShim(argv: string[]): string[] {
  const hasNoRunner = argv.includes('--no-runner')
  if (hasNoRunner) {
    failBeforeParse(
      argv,
      messages.removedNoRunnerFlag(),
      CODES.E_REMOVED_FLAG,
      '--no-runner was removed. Use --no-browser instead.',
      '--no-runner'
    )
  }

  let nextArgv = argv
  // --no-reload: dev-only; skips the reinjection wrapper + reload dispatch so an
  // open tab is undisturbed. Env var because plugins don't see CLI flags.
  const hasNoReload = nextArgv.includes('--no-reload')
  if (hasNoReload) {
    const command = resolveCommandFromArgv(nextArgv)
    if (command !== 'dev') {
      const message = `--no-reload is only supported on \`extension dev\` (got: ${command || 'no command'}).`
      failBeforeParse(
        nextArgv,
        message,
        CODES.E_FLAG_NOT_SUPPORTED_HERE,
        message,
        '--no-reload'
      )
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
    failBeforeParse(
      nextArgv,
      messages.noBrowserNotSupportedForCommand(command),
      CODES.E_FLAG_NOT_SUPPORTED_HERE,
      command
        ? `--no-browser is not supported on \`extension ${command}\`.`
        : '--no-browser needs a command that launches a browser.',
      '--no-browser'
    )
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
  // Parse failures render through commanderHumanError in the catch block, so
  // commander's own error line and help dump stay silent.
  .configureOutput({outputError: () => {}})
  .showSuggestionAfterError(true)
  // Before the register* calls: subcommands copy the override at creation, and
  // without it a parse failure exits before any json envelope can be written.
  .exitOverride()

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
registerCapabilitiesCommand(extensionJs)

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
  const argv = applyNoBrowserArgvShim(applyOutputAliasArgvShim(process.argv))
  const asJson = wantsJsonOutput(argv)
  const commandName = resolveCommandFromArgv(argv) || 'extension'

  void (async () => {
    try {
      await extensionJs.parseAsync(argv)
      markCommandSuccess()
    } catch (err: unknown) {
      if (isCommanderError(err)) {
        const exitCode = commanderExitCode(err)
        // exitCode 0 is help or version display, not a failure.
        if (exitCode === 0) process.exit(0)
        markCommandFailure()
        // eslint-disable-next-line no-console
        console.error(commanderHumanError(err, commandName))
        if (asJson) {
          writeStdoutFrame(commanderErrorEnvelope(err, commandName))
        }
        await exitAfterDrain(exitCode)
        return
      }

      markCommandFailure()
      // eslint-disable-next-line no-console
      console.error(messages.unhandledError(err))
      if (asJson && !isErrorFramed(err)) {
        writeStdoutFrame(internalErrorEnvelope(err, commandName))
      }
      await exitAfterDrain(1)
    }
  })()
}
