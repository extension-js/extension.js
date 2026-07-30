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
import {exitAfterDrain} from '../helpers/exit-after-drain'
import {resolveExtensionDevelopRoot} from '../helpers/extension-develop-runtime'
import {commandDescriptions} from '../helpers/messages'
import {CODES, ENVELOPE, type ErrorCode} from '../helpers/messaging'
import {
  DEFAULT_TEMPLATE,
  renderCreateTemplateHelp
} from '../helpers/template-catalog'
import {parseOptionalBoolean} from '../helpers/vendors'

const require = createRequire(import.meta.url)

// Stopgap: extension-create rethrows one formatted string with no code on it,
// so the failure class is only readable off the error name or its copy. A spec
// pins each needle against the real message so a copy edit fails loudly.
export const CREATE_ERROR_NEEDLES = {
  E_DESTINATION_NOT_EMPTY: 'already contains files that would be overwritten',
  E_DESTINATION_NOT_WRITABLE: "Couldn't write to the destination directory",
  E_TEMPLATE_NOT_FOUND: 'is not in the extension-js/examples catalog'
} as const

function createErrorCode(error: unknown): ErrorCode {
  const name = (error as Error | undefined)?.name || ''
  if (name === 'TemplateNotFoundError') return CODES.E_TEMPLATE_NOT_FOUND
  if (name === 'TemplateDownloadError') return CODES.E_NETWORK

  const message = String((error as Error | undefined)?.message || error)
  for (const [code, needle] of Object.entries(CREATE_ERROR_NEEDLES)) {
    if (message.includes(needle)) return code as ErrorCode
  }
  return CODES.E_INTERNAL
}

export function registerCreateCommand(program: Command) {
  program
    .command('create')
    .arguments('<project-name|project-path>')
    .usage('<project-name|project-path> [options]')
    .description(commandDescriptions.create)
    .option(
      '-t, --template <template-name>',
      `catalog name, GitHub URL, or ZIP URL to scaffold from; every catalog name is listed below (default: ${DEFAULT_TEMPLATE})`
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
    .option(
      '--output <pretty|json>',
      'result format. Use json for a schema-1 envelope on stdout'
    )
    .addHelpText('after', renderCreateTemplateHelp())
    .action(
      async (
        pathOrRemoteUrl: string,
        {
          template,
          install,
          output
        }: CreateOptions & {output?: 'pretty' | 'json'}
      ) => {
        const asJson = output === 'json'

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

        // The scaffold logs its progress lines on stdout. Under --output json
        // stdout carries the envelope alone, so route them to stderr.
        const logger = asJson
          ? {
              log: (...args: unknown[]) => console.error(...args),
              error: (...args: unknown[]) => console.error(...args)
            }
          : undefined

        let result: Awaited<ReturnType<typeof extensionCreate>>
        try {
          result = await extensionCreate(pathOrRemoteUrl, {
            template,
            install,
            logger,
            cliVersion: getCliPackageJson().version
          })
        } catch (error) {
          if (!asJson) throw error

          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify(
              ENVELOPE.fail('create', 'failed', {
                code: createErrorCode(error),
                message: error instanceof Error ? error.message : String(error)
              })
            )
          )
          await exitAfterDrain(1)
          return
        }

        if (asJson) {
          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify(
              ENVELOPE.ok('create', 'created', {
                projectPath: result?.projectPath ?? pathOrRemoteUrl,
                projectName: result?.projectName,
                template: result?.template ?? template ?? null,
                depsInstalled: result?.depsInstalled ?? Boolean(install)
              })
            )
          )
        }
      }
    )
}
