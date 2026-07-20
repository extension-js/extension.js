//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createRequire} from 'node:module'
import * as path from 'node:path'
import type {Command} from 'commander'
import type {CreateOptions} from 'extension-create'
import {getCliPackageJson} from '../helpers/cli-package-json'
import {resolveExtensionDevelopRoot} from '../helpers/extension-develop-runtime'
import {commandDescriptions} from '../helpers/messages'
import {parseOptionalBoolean} from '../helpers/vendors'

const require = createRequire(import.meta.url)

export function registerCreateCommand(program: Command) {
  program
    .command('create')
    .arguments('<project-name|project-path>')
    .usage('<project-name|project-path> [options]')
    .description(commandDescriptions.create)
    .option(
      '-t, --template <template-name>',
      'specify a template for the created project'
    )
    .option(
      '--install [boolean]',
      'whether or not to install the dependencies after creating the project (disabled by default, pass --install to opt in)',
      parseOptionalBoolean,
      false
    )
    .option(
      '--source <source>',
      'attribution tag for where this create was initiated (e.g. cli, templates); recorded in anonymous telemetry only'
    )
    .action(
      async (pathOrRemoteUrl: string, {template, install}: CreateOptions) => {
        if (!process.env.EXTENSION_CREATE_DEVELOP_ROOT) {
          try {
            process.env.EXTENSION_CREATE_DEVELOP_ROOT =
              resolveExtensionDevelopRoot()
          } catch {
            try {
              const developPkg = require.resolve(
                'extension-develop/package.json'
              )
              process.env.EXTENSION_CREATE_DEVELOP_ROOT =
                path.dirname(developPkg)
            } catch {
              // Some extension-develop builds don't export package.json.
              // Fallback to the main entry and infer package root.
              try {
                const developEntry = require.resolve('extension-develop')
                process.env.EXTENSION_CREATE_DEVELOP_ROOT = path.dirname(
                  path.dirname(developEntry)
                )
              } catch {
                // Ignore
              }
            }
          }
        }
        const {extensionCreate} = await import('extension-create')

        await extensionCreate(pathOrRemoteUrl, {
          template,
          install,
          cliVersion: getCliPackageJson().version
        })
      }
    )
}
