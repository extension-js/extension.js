#!/usr/bin/env node

//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {program} from 'commander'
import checkUpdates from './check-updates'
import * as messages from './cli-lib/messages'
import {telemetry} from './cli-lib/telemetry-cli'
import {getCliPackageJson} from './cli-package-json'

import {registerCreateCommand} from './commands/create'
import {registerDevCommand} from './commands/dev'
import {registerStartCommand} from './commands/start'
import {registerPreviewCommand} from './commands/preview'
import {registerBuildCommand} from './commands/build'

const cliPackageJson = getCliPackageJson()

function developVersion() {
  try {
    const pkg = require('extension-develop/package.json')
    return pkg?.version || cliPackageJson.version
  } catch {
    return cliPackageJson.version
  }
}

process.env.EXTENSION_DEVELOP_VERSION = developVersion()

function resolveAIHelpFormatFromArgv(argv: string[]): string {
  const equalArg = argv.find((arg) => arg.startsWith('--format='))
  if (equalArg) return equalArg.slice('--format='.length)

  const formatIndex = argv.indexOf('--format')
  if (formatIndex >= 0) return argv[formatIndex + 1] || ''

  return 'pretty'
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

registerCreateCommand(extensionJs, telemetry)
registerDevCommand(extensionJs, telemetry)
registerStartCommand(extensionJs, telemetry)
registerPreviewCommand(extensionJs, telemetry)
registerBuildCommand(extensionJs, telemetry)

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

extensionJs.parseAsync().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(messages.unhandledError(err))
  process.exit(1)
})
