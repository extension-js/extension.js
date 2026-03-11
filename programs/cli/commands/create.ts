//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import type {Command} from 'commander'
import {createRequire} from 'module'
import type {CreateOptions} from 'extension-create'
import {commandDescriptions} from '../cli-lib/messages'
import {collectWorkflowProfile} from '../cli-lib/workflow-profile'
import {getCliPackageJson} from '../cli-package-json'
import {parseOptionalBoolean} from '../utils'

const require = createRequire(import.meta.url)

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
    .option(
      '--install [boolean]',
      'whether or not to install the dependencies after creating the project (enabled by default)',
      parseOptionalBoolean,
      true
    )
    .action(async function (
      pathOrRemoteUrl: string,
      {template, install}: CreateOptions
    ) {
      const startedAt = Date.now()
      const templateValue = String(template || 'default')
      const isRemoteTemplate = /^https?:/i.test(templateValue)
      const workflowProfile = collectWorkflowProfile({
        command: 'create',
        isRemoteInput: isRemoteTemplate
      })

      telemetry.track('workflow_profile', {
        command: 'create',
        ...workflowProfile
      })
      telemetry.track('cli_command_start', {
        command: 'create',
        template: templateValue,
        template_source: isRemoteTemplate ? 'remote' : 'built_in',
        install: Boolean(install),
        ...workflowProfile
      })

      try {
        if (!process.env.EXTENSION_CREATE_DEVELOP_ROOT) {
          try {
            const developPkg = require.resolve('extension-develop/package.json')
            process.env.EXTENSION_CREATE_DEVELOP_ROOT = path.dirname(developPkg)
          } catch {
            // Some extension-develop builds don't export package.json.
            // Fallback to the main entry and infer package root.
            try {
              const developEntry = require.resolve('extension-develop')
              process.env.EXTENSION_CREATE_DEVELOP_ROOT = path.dirname(
                path.dirname(developEntry)
              )
            } catch {
              // Leave unset if extension-develop is not available
            }
          }
        }
        // Load the matching create runtime from the regular dependency graph.
        const {extensionCreate} = await import('extension-create')

        await extensionCreate(pathOrRemoteUrl, {
          template,
          install,
          cliVersion: getCliPackageJson().version
        })

        telemetry.track('cli_command_finish', {
          command: 'create',
          duration_ms: Date.now() - startedAt,
          success: true,
          exit_code: 0,
          ...workflowProfile
        })
      } catch (err) {
        telemetry.track('cli_command_finish', {
          command: 'create',
          duration_ms: Date.now() - startedAt,
          success: false,
          exit_code: 1,
          ...workflowProfile
        })
        throw err
      }
    })
}
