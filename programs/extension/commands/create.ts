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
import {declaredErrorCode} from '../helpers/cli-failure'
import {getCliPackageJson} from '../helpers/cli-package-json'
import {recordDependencyInstall} from '../helpers/dependency-install-outcome'
import {exitAfterDrain} from '../helpers/exit-after-drain'
import {resolveExtensionDevelopRoot} from '../helpers/extension-develop-runtime'
import {
  commandDescriptions,
  createNeedsProjectName,
  createProjectNameQuestion
} from '../helpers/messages'
import {CODES, ENVELOPE, type ErrorCode} from '../helpers/messaging'
import {isJsonOutput, refuseUnreadableOutput} from '../helpers/output-flag'
import {
  askProjectName,
  canPromptForProjectName,
  createCommandFor,
  DEFAULT_PROJECT_NAME,
  type PromptIo
} from '../helpers/project-name-prompt'
import {markCommandFailure} from '../helpers/telemetry-cli'
import {
  DEFAULT_TEMPLATE,
  renderCreateTemplateHelp
} from '../helpers/template-catalog'
import {parseOptionalBoolean} from '../helpers/vendors'

const require = createRequire(import.meta.url)

// extension-create puts the code on every failure it frames, so the code
// travels with the error and a copy edit can never change what a script reads.
// Anything without a catalog code is a fault nobody classified.
function createErrorCode(error: unknown): ErrorCode {
  return declaredErrorCode(error) ?? CODES.E_INTERNAL
}

// A missing name was the most common first-run failure. A person at a
// terminal is asked for one, anything else gets the exact command to copy.
async function resolveProjectName(
  template: string | undefined,
  asJson: boolean,
  promptIo: PromptIo
): Promise<string | undefined> {
  if (!asJson && canPromptForProjectName(promptIo)) {
    const answer = await askProjectName(
      createProjectNameQuestion(DEFAULT_PROJECT_NAME),
      promptIo
    )

    if (answer) return answer

    markCommandFailure(undefined, {code: CODES.E_INTERRUPTED, exitCode: 130})
    await exitAfterDrain(130)

    return undefined
  }

  const command = createCommandFor(template)
  markCommandFailure(undefined, {code: CODES.E_ARGS, exitCode: 1})

  // eslint-disable-next-line no-console
  console.error(createNeedsProjectName(command))

  if (asJson) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        ENVELOPE.fail('create', 'usage', {
          code: CODES.E_ARGS,
          message: `A project name is required. Run ${command} to start one.`,
          name: 'CliError'
        })
      )
    )
  }

  await exitAfterDrain(1)

  return undefined
}

// Where the name prompt reads and writes, the process streams when left out.
export function registerCreateCommand(
  program: Command,
  {promptIo = {}}: {promptIo?: PromptIo} = {}
) {
  program
    .command('create')
    .arguments('[project-name|project-path]')
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
    .hook('preAction', refuseUnreadableOutput())
    .addHelpText('after', renderCreateTemplateHelp())
    .action(
      async (
        projectInput: string | undefined,
        {
          template,
          install,
          output
        }: CreateOptions & {output?: 'pretty' | 'json'}
      ) => {
        const asJson = isJsonOutput({output})
        const pathOrRemoteUrl =
          projectInput || (await resolveProjectName(template, asJson, promptIo))

        if (!pathOrRemoteUrl) return

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
          if (createErrorCode(error) === CODES.E_DEPENDENCY_INSTALL) {
            recordDependencyInstall('failed')
          }

          // The non-json path throws and index.ts marks the failure there. The
          // json path returns instead of throwing, so it has to mark its own,
          // and without this create could not report a failure at all.
          markCommandFailure(undefined, {
            code: createErrorCode(error),
            exitCode: 1,
            error,
            step: 'scaffold'
          })

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

        recordDependencyInstall(
          result?.depsInstalled ? 'installed' : 'skipped',
          result?.installSeconds
        )

        if (asJson) {
          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify(
              ENVELOPE.ok('create', 'created', {
                projectPath: result?.projectPath ?? pathOrRemoteUrl,
                projectName: result?.projectName,
                packageName: result?.packageName,
                template: result?.template ?? template ?? null,
                depsInstalled: result?.depsInstalled ?? Boolean(install)
              })
            )
          )
        }
      }
    )
}
