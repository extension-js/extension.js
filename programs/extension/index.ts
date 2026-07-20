#!/usr/bin/env node

//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {program} from 'commander'
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
import {resolveExtensionDevelopVersion} from './helpers/extension-develop-runtime'
import * as messages from './helpers/messages'
import {markCommandFailure, markCommandSuccess} from './helpers/telemetry-cli'

// Public type surface for `extension.config.js`. Re-exported from the root so
// consumers can annotate their config with `import('extension').FileConfig`.
// These are type-only re-exports (erased at runtime). They live in a
// self-contained local module because `extension-develop` does not publish
// declaration files. See `config-types.ts` for the sync note.
// The `.js` extension is required: this package is ESM (`"type": "module"`),
// so the emitted declaration's relative re-export must carry an explicit
// extension to resolve under consumer `node16`/`nodenext` module resolution
// (TS2834). Without it the type silently degrades to `any` under skipLibCheck.
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
  .name(String(cliPackageJson.name))
  .description(String(cliPackageJson.description))
  .version(String(cliPackageJson.version))
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
registerLogsCommand(extensionJs)
registerActCommands(extensionJs)
registerPublishCommand(extensionJs)
registerInstallCommand(extensionJs)
registerTelemetryCommand(extensionJs)
registerDoctorCommand(extensionJs)

extensionJs.on('option:ai-help', () => {
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
