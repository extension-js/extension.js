//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import type {Command} from 'commander'
import type {CreateOptions} from 'extension-create'
import {commandDescriptions} from '../cli-lib/messages'
import {getCliPackageJson} from '../cli-package-json'

export function registerCreateCommand(program: Command, telemetry: any) {
  program
    .command('create')
    .arguments('<project-name|project-path>')
    .usage('create <project-name|project-path> [options]')
    .description(commandDescriptions.create)
    .option(
      '-t, --template <template-name>',
      'specify a template for the created project'
    )
    .action(async function (
      pathOrRemoteUrl: string,
      {template}: CreateOptions
    ) {
      const startedAt = Date.now()
      telemetry.track('cli_command_start', {
        command: 'create',
        template: template || 'default'
      })

      try {
        // Load the matching create runtime from the regular dependency graph.
        const {extensionCreate} = await import('extension-create')

        const projectPath = path.isAbsolute(pathOrRemoteUrl)
          ? pathOrRemoteUrl
          : path.join(process.cwd(), pathOrRemoteUrl)

        await extensionCreate(pathOrRemoteUrl, {
          template,
          cliVersion: getCliPackageJson().version
        })

        telemetry.track('cli_command_finish', {
          command: 'create',
          duration_ms: Date.now() - startedAt,
          success: true,
          exit_code: 0
        })
      } catch (err) {
        telemetry.track('cli_command_finish', {
          command: 'create',
          duration_ms: Date.now() - startedAt,
          success: false,
          exit_code: 1
        })
        throw err
      }
    })
}
