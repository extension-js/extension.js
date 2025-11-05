import type {Command} from 'commander'
import {extensionCreate, type CreateOptions} from 'extension-create'
import packageJson from '../package.json'
import {parseOptionalBoolean} from '../utils'

export function registerCreateCommand(program: Command, telemetry: any) {
  program
    .command('create')
    .arguments('<project-name|project-path>')
    .usage('create <project-name|project-path> [options]')
    .description('Creates a new extension.')
    .option(
      '-t, --template <template-name>',
      'specify a template for the created project'
    )
    .option(
      '--install [boolean]',
      'whether or not to install the dependencies after creating the project (disabled by default)',
      parseOptionalBoolean,
      false
    )
    .action(async function (
      pathOrRemoteUrl: string,
      {template, install}: CreateOptions
    ) {
      const startedAt = Date.now()
      telemetry.track('cli_command_start', {
        command: 'create',
        template: template || 'default',
        install: Boolean(install)
      })

      try {
        await extensionCreate(pathOrRemoteUrl, {
          template,
          install,
          cliVersion: packageJson.version
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
