//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {Command, CommanderError, Option} from 'commander'
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
import {registerSafariCommand} from './commands/safari'
import {registerStartCommand} from './commands/start'
import {registerTelemetryCommand} from './commands/telemetry'
import checkUpdates, {
  settleUpdateCheck,
  type UpdateNotice,
  updateCheckWanted
} from './helpers/check-updates'
import {
  collectValuedLongFlags,
  findFlagMissingItsValue,
  findSubcommand,
  moveCommandFlagsBehindCommand,
  movePreCommandOutputArgv,
  resolveCommandFromArgv as resolveCommandFromArgvWithFlags,
  rewriteOutputAliasArgv,
  scanArgvValue
} from './helpers/cli-argv'
import {
  codeForCommanderError,
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
import {
  claimInterruptFrame,
  interruptedAfterBuildTold
} from './helpers/early-interrupt'
import {exitAfterDrain} from './helpers/exit-after-drain'
import {resolveExtensionDevelopVersion} from './helpers/extension-develop-runtime'
import * as messages from './helpers/messages'
import {CODES} from './helpers/messaging'
import {
  normalizeOutputFormat,
  outputFlagTypedAs,
  warnDeprecatedOutputAlias
} from './helpers/output-flag'
import {
  markCommandFailure,
  markCommandSuccess,
  reportCommandFailureNow,
  resolveInvokedCommand,
  telemetryFailureCode
} from './helpers/telemetry-cli'
import {installTelemetrySignalHandlers} from './helpers/telemetry-signals'

// What a test replaces to run the CLI in process without touching the machine.
export interface RunDeps {
  exit: (code: number) => void
  stdout: (text: string) => void
  stderr: (text: string) => void
  writeFrame: (frame: unknown) => void
  checkUpdates: () => Promise<UpdateNotice | null>
  stderrIsTerminal: () => boolean
}

export function processRunDeps(): RunDeps {
  return {
    exit: (code) => process.exit(code),
    stdout: (text) => {
      process.stdout.write(text)
    },
    stderr: (text) => {
      process.stderr.write(text)
    },
    writeFrame: writeStdoutFrame,
    checkUpdates: () => checkUpdates(),
    stderrIsTerminal: () => process.stderr.isTTY === true
  }
}

// Thrown after deps.exit so an in-process run stops where a real exit would.
class RunEnded extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`)
  }
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

// Resolves with the exit code the run chose, or 0 when the command finished
// and left the process to end on its own.
export async function run(argv: string[], deps: RunDeps): Promise<number> {
  try {
    return await runUntilEnd(argv, deps)
  } catch (error) {
    if (error instanceof RunEnded) return error.code

    throw error
  }
}

function endRun(deps: RunDeps, code: number): never {
  claimInterruptFrame()
  deps.exit(code)

  throw new RunEnded(code)
}

async function runUntilEnd(argv: string[], deps: RunDeps): Promise<number> {
  // Before any command action runs, so this listener sees a Ctrl-C ahead of the
  // browser and dev-server teardown handlers those actions install later.
  installTelemetrySignalHandlers()

  const cliPackageJson = getCliPackageJson()

  process.env.EXTENSION_DEVELOP_VERSION = resolveExtensionDevelopVersion(
    __dirname,
    cliPackageJson.version
  )

  // Filled once every command is registered, so the pre-parse scans skip the
  // value of any flag that takes one instead of reading it as the command.
  let valuedLongFlags: ReadonlySet<string> = new Set()

  function resolveCommandFromArgv(args: string[]): string | undefined {
    return resolveCommandFromArgvWithFlags(args, valuedLongFlags)
  }

  // A pre-parse refusal must still leave one machine frame on stdout when the
  // caller asked for json, or the exit code arrives with nothing explaining it.
  function failBeforeParse(
    args: string[],
    humanMessage: string,
    code: (typeof CODES)[keyof typeof CODES],
    plainMessage: string,
    flag: string
  ): never {
    deps.stderr(`${humanMessage}\n`)

    if (wantsJsonOutput(args)) {
      deps.writeFrame(
        earlyExitEnvelope(
          resolveCommandFromArgv(args) || 'extension',
          code,
          plainMessage,
          {flag}
        )
      )
    }

    try {
      reportCommandFailureNow({code, exitCode: 1})
    } catch {
      // Ignore
    }

    return endRun(deps, 1)
  }

  // --format is a deprecated alias of --output. Only the root program declares
  // it (for --ai-help), so on a subcommand commander accepted it and nobody read
  // it: the run printed human output while the caller waited for an envelope.
  function applyOutputAliasArgvShim(args: string[]): string[] {
    // --ai-help resolves the alias itself, and it never reaches a subcommand.
    if (args.includes('--ai-help')) return args

    const typedOutput = args.some(
      (arg) => arg === '--output' || arg.startsWith('--output=')
    )
    const {argv: next, rewritten} = rewriteOutputAliasArgv(
      args,
      valuedLongFlags
    )

    // A refused value then names the flag the user typed.
    outputFlagTypedAs(rewritten && !typedOutput ? '--format' : '--output')
    if (rewritten) warnDeprecatedOutputAlias('--format')

    return movePreCommandOutputArgv(next, valuedLongFlags)
  }

  function applyNoBrowserArgvShim(args: string[]): string[] {
    const hasNoRunner = args.includes('--no-runner')

    if (hasNoRunner) {
      failBeforeParse(
        args,
        messages.removedNoRunnerFlag(),
        CODES.E_REMOVED_FLAG,
        '--no-runner was removed. Use --no-browser instead.',
        '--no-runner'
      )
    }

    let nextArgv = args
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

  let pendingUpdateCheck: Promise<void> | undefined

  function startUpdateCheck(args: string[]): void {
    const json =
      wantsJsonOutput(args) ||
      normalizeOutputFormat(scanArgvValue(args, '--wait-format')) === 'json'

    if (
      !updateCheckWanted({
        command: resolveCommandFromArgv(args),
        json,
        terminal: deps.stderrIsTerminal(),
        env: process.env
      })
    ) {
      return
    }

    pendingUpdateCheck = deps.checkUpdates().then((updateMessage) => {
      if (!updateMessage) return

      if (process.env.EXTENSION_CLI_BANNER_PRINTED === 'true') {
        // stderr, not stdout: this resolves after the banner and would otherwise
        // land at an arbitrary point inside the command's own output.
        deps.stderr(`${updateMessage.message}\n`)

        return
      }

      process.env.EXTENSION_CLI_UPDATE_SUFFIX = updateMessage.suffix
    })
  }

  const extensionJs = new Command()

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
    .configureOutput({
      writeOut: deps.stdout,
      writeErr: deps.stderr,
      outputError: () => {}
    })
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
  registerSafariCommand(extensionJs)
  registerInstallCommand(extensionJs)
  registerTelemetryCommand(extensionJs)
  registerDoctorCommand(extensionJs)
  registerCapabilitiesCommand(extensionJs)
  valuedLongFlags = collectValuedLongFlags(extensionJs)
  resolveInvokedCommand(argv, valuedLongFlags)

  // Handled before commander parses: the JSON frame can outgrow one pipe
  // buffer, so the exit must wait for stdout to drain (#79).
  async function runAIHelp(): Promise<number> {
    const format = resolveAIHelpFormatFromArgv(argv).trim().toLowerCase()

    if (format === 'json') {
      deps.stdout(
        `${JSON.stringify(
          messages.programAIHelpJSON(String(cliPackageJson.version)),
          null,
          2
        )}\n`
      )

      await exitAfterDrain(0, {exit: deps.exit})

      return 0
    }

    if (format !== 'pretty') {
      deps.stderr(`${messages.invalidAIHelpFormat(format)}\n`)
      await exitAfterDrain(1, {exit: deps.exit})

      return 1
    }

    deps.stdout(`${messages.programAIHelp()}\n`)
    await exitAfterDrain(0, {exit: deps.exit})

    return 0
  }

  if (argv.length <= 2) {
    extensionJs.outputHelp()

    return endRun(deps, 0)
  }

  if (argv.includes('--ai-help')) return runAIHelp()

  const parsedArgv = moveCommandFlagsBehindCommand(
    applyNoBrowserArgvShim(applyOutputAliasArgvShim(argv)),
    extensionJs,
    valuedLongFlags
  )
  const asJson = wantsJsonOutput(parsedArgv)
  const typedCommand = resolveCommandFromArgv(parsedArgv)
  const commandName = typedCommand || 'extension'

  // A bare run prints the help for a person. A caller that asked for json and
  // named no command gets that answer as a frame, not a refusal of the flag.
  const asksForHelpOrVersion = parsedArgv.some((arg) =>
    ['--help', '-h', '--version', '-V'].includes(arg)
  )

  if (asJson && !typedCommand && !asksForHelpOrVersion) {
    const message = messages.noCommandGivenText()

    deps.stderr(`${messages.noCommandGiven()}\n`)
    deps.writeFrame(earlyExitEnvelope('extension', CODES.E_ARGS, message))

    try {
      reportCommandFailureNow({code: CODES.E_ARGS, exitCode: 1})
    } catch {
      // Ignore
    }

    return endRun(deps, 1)
  }

  // An unknown flag's value can read as the command, and its help would then
  // name a command that does not exist.
  function commandNameFor(err: {code?: unknown}): string {
    if (err.code === 'commander.unknownCommand') return commandName

    return findSubcommand(extensionJs, typedCommand) ? commandName : 'extension'
  }

  startUpdateCheck(parsedArgv)

  try {
    const missingValue = findFlagMissingItsValue(
      parsedArgv,
      extensionJs,
      valuedLongFlags
    )

    if (missingValue) {
      throw new CommanderError(
        1,
        'commander.optionMissingArgument',
        `error: option '${missingValue.flags}' argument missing`
      )
    }

    await extensionJs.parseAsync(parsedArgv)

    // A build ends before a registry on a real network answers. The answer is
    // awaited, within the check's own bound, so it is told and kept for next time.
    if (
      typedCommand === 'build' &&
      pendingUpdateCheck &&
      !interruptedAfterBuildTold()
    ) {
      await settleUpdateCheck(pendingUpdateCheck)
    }

    // The exit code stays the build's, so the signal is answered in words.
    if (interruptedAfterBuildTold() && !asJson) {
      deps.stderr(`${messages.signalAfterBuild()}\n`)
    }

    // The command wrote its own ending, so a late signal adds no frame.
    claimInterruptFrame()
    markCommandSuccess()

    return 0
  } catch (err: unknown) {
    if (err instanceof RunEnded) throw err

    if (isCommanderError(err)) {
      const exitCode = commanderExitCode(err)
      // exitCode 0 is help or version display, not a failure.
      if (exitCode === 0) return endRun(deps, 0)

      markCommandFailure(undefined, {
        code: codeForCommanderError(String(err.code)),
        exitCode
      })

      const failedCommand = commandNameFor(err)

      deps.stderr(`${commanderHumanError(err, failedCommand)}\n`)

      if (asJson) {
        deps.writeFrame(commanderErrorEnvelope(err, failedCommand))
      }

      await exitAfterDrain(exitCode, {exit: deps.exit})

      return exitCode
    }

    // A command that framed its own failure carries the precise code; an
    // unframed throw is an internal error and says so.
    markCommandFailure(undefined, {
      code:
        telemetryFailureCode((err as {code?: unknown} | undefined)?.code) ||
        CODES.E_INTERNAL,
      exitCode: 1,
      error: err,
      step: 'action'
    })

    deps.stderr(`${messages.unhandledError(err)}\n`)

    if (asJson && !isErrorFramed(err)) {
      deps.writeFrame(internalErrorEnvelope(err, commandName))
    }

    await exitAfterDrain(1, {exit: deps.exit})

    return 1
  }
}
