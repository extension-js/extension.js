#!/usr/bin/env node

import {program} from 'commander'
import packageJson from './package.json'
import checkUpdates from './check-updates'
import * as messages from './cli-lib/messages'
import {telemetry} from './cli-lib/telemetry-cli'

import {registerCreateCommand} from './commands/create'
import {registerDevCommand} from './commands/dev'
import {registerStartCommand} from './commands/start'
import {registerPreviewCommand} from './commands/preview'
import {registerBuildCommand} from './commands/build'

checkUpdates(packageJson)

const extensionJs = program

extensionJs
  .name(packageJson.name)
  .description(packageJson.description)
  .version(packageJson.version)
  .option('--no-telemetry', 'disable anonymous telemetry for this run')
  .option('--ai-help', 'show AI-assistant oriented help and tips')
  .addHelpText('after', messages.programUserHelp())

registerCreateCommand(extensionJs, telemetry)
registerDevCommand(extensionJs, telemetry)
registerStartCommand(extensionJs, telemetry)
registerPreviewCommand(extensionJs, telemetry)
registerBuildCommand(extensionJs, telemetry)

extensionJs.on('option:ai-help', function () {
  // eslint-disable-next-line no-console
  console.log(messages.programAIHelp())
  process.exit(0)
})

extensionJs.parse()
