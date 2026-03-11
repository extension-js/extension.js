//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import type {Command} from 'commander'
import * as messages from '../cli-lib/messages'
import {commandDescriptions} from '../cli-lib/messages'
import {collectProjectProfile} from '../cli-lib/project-profile'
import {collectWorkflowProfile} from '../cli-lib/workflow-profile'
import {parseExtensionsList} from '../utils/normalize-options'
import {
  vendors,
  validateVendorsOrExit,
  type Browser,
  parseOptionalBoolean
} from '../utils'

type BuildOptions = {
  browser?: Browser | 'all'
  polyfill?: boolean
  zip?: boolean
  zipSource?: boolean
  zipFilename?: string
  silent?: boolean
  install?: boolean
  extensions?: string
}

export function registerBuildCommand(program: Command, telemetry: any) {
  program
    .command('build')
    .arguments('[project-name]')
    .usage('build [path-to-remote-extension] [options]')
    .description(commandDescriptions.build)
    .option(
      '--browser <chrome | chromium | edge | firefox | chromium-based | gecko-based | firefox-based>',
      'specify a browser/engine to run. Defaults to `chromium`'
    )
    .option(
      '--polyfill [boolean]',
      'whether or not to apply the cross-browser polyfill. Defaults to `false`'
    )
    .option(
      '--zip [boolean]',
      'whether or not to compress the extension into a ZIP file. Defaults to `false`'
    )
    .option(
      '--zip-source [boolean]',
      'whether or not to include the source files in the ZIP file. Defaults to `false`'
    )
    .option(
      '--zip-filename <string>',
      'specify the name of the ZIP file. Defaults to the extension name and version'
    )
    .option(
      '--silent [boolean]',
      'whether or not to open the browser automatically. Defaults to `false`'
    )
    .option(
      '--install [boolean]',
      '[internal] install project dependencies when missing',
      parseOptionalBoolean
    )
    .option(
      '--extensions <list>',
      'comma-separated list of companion extensions or store URLs to load'
    )
    .option(
      '--author, --author-mode',
      '[internal] enable maintainer diagnostics (does not affect user runtime logs)'
    )
    .action(async function (
      pathOrRemoteUrl: string,
      {browser = 'chromium', ...buildOptions}: BuildOptions
    ) {
      if ((buildOptions as any).author || (buildOptions as any)['authorMode']) {
        process.env.EXTENSION_AUTHOR_MODE = 'true'
        if (!process.env.EXTENSION_VERBOSE) process.env.EXTENSION_VERBOSE = '1'
      }

      const cmdStart = Date.now()
      const list = vendors(browser)
      const isRemoteInput =
        typeof pathOrRemoteUrl === 'string' && /^https?:/i.test(pathOrRemoteUrl)
      const artifactKind = buildOptions.zipSource
        ? buildOptions.zip
          ? 'zip_and_source'
          : 'source_zip'
        : buildOptions.zip
          ? 'zip'
          : 'directory'
      const projectProfile = collectProjectProfile(
        !isRemoteInput && pathOrRemoteUrl ? pathOrRemoteUrl : process.cwd()
      )
      const workflowProfile = collectWorkflowProfile({
        command: 'build',
        isMultiBrowser: list.length > 1,
        isRemoteInput: isRemoteInput,
        companionExtensionsProvided: Boolean(buildOptions.extensions),
        artifactKind,
        packageManager: projectProfile?.package_manager,
        frameworkPrimary: projectProfile?.framework_primary,
        hasNextDependency: projectProfile?.has_next_dependency,
        hasTurboDependency: projectProfile?.has_turbo_dependency
      })

      telemetry.track('workflow_profile', {
        command: 'build',
        ...workflowProfile
      })
      telemetry.track('cli_command_start', {
        command: 'build',
        vendors: list,
        browser_count: list.length,
        is_multi_browser: list.length > 1,
        is_remote_input: isRemoteInput,
        polyfill_used: buildOptions.polyfill || false,
        zip: buildOptions.zip || false,
        zip_source: buildOptions.zipSource || false,
        artifact_kind: artifactKind,
        ...workflowProfile
      })

      validateVendorsOrExit(list, (invalid, supported) => {
        // eslint-disable-next-line no-console
        console.error(messages.unsupportedBrowserFlag(invalid, supported))
      })

      // Load the matching develop runtime from the regular dependency graph.
      const {extensionBuild}: {extensionBuild: any} = await import(
        'extension-develop'
      )

      for (const vendor of list) {
        const vendorStart = Date.now()
        telemetry.track('cli_vendor_start', {command: 'build', vendor})

        const buildSummary = await extensionBuild(pathOrRemoteUrl, {
          browser: vendor as BuildOptions['browser'],
          polyfill: buildOptions.polyfill,
          zip: buildOptions.zip,
          zipSource: buildOptions.zipSource,
          zipFilename: buildOptions.zipFilename,
          silent: buildOptions.silent,
          install: buildOptions.install,
          extensions: parseExtensionsList((buildOptions as any).extensions)
        })

        telemetry.track('cli_build_summary', {
          ...buildSummary,
          browser_count: list.length,
          is_multi_browser: list.length > 1,
          is_remote_input: isRemoteInput,
          artifact_kind: artifactKind,
          ...workflowProfile
        })

        telemetry.track('cli_vendor_finish', {
          command: 'build',
          vendor,
          duration_ms: Date.now() - vendorStart
        })
      }

      telemetry.track('cli_command_finish', {
        command: 'build',
        duration_ms: Date.now() - cmdStart,
        success: process.exitCode === 0 || process.exitCode == null,
        exit_code: process.exitCode ?? 0,
        ...workflowProfile
      })
    })
}
