//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import type {Command} from 'commander'
import * as messages from '../helpers/messages'
import {loadExtensionDevelopModule} from '../helpers/extension-develop-runtime'
import {commandDescriptions} from '../helpers/messages'
import {parseExtensionsList} from '../helpers/normalize-options'
import {
  vendors,
  validateVendorsOrExit,
  isSafariVendor,
  type Browser,
  parseOptionalBoolean
} from '../helpers/vendors'
import {
  packageSafariExtension,
  safariBuildPreflight
} from '../browsers/run-safari/safari-launch'
import {isValidBundleId} from '../browsers/run-safari/safari-launch/safari-config'

type BuildOptions = {
  browser?: Browser | 'all'
  polyfill?: boolean
  zip?: boolean
  zipSource?: boolean
  zipFilename?: string
  silent?: boolean
  install?: boolean
  extensions?: string
  mode?: string
  open?: boolean
  appName?: string
  bundleId?: string
  forceRegenerate?: boolean
}

export function registerBuildCommand(program: Command) {
  program
    .command('build')
    .arguments('[project-name]')
    .usage('[path-to-remote-extension] [options]')
    .description(commandDescriptions.build)
    .option(
      '--browser <chrome | chromium | edge | firefox | chromium-based | gecko-based | firefox-based | safari | webkit-based>',
      'specify a browser/engine to run. Defaults to `chromium`. `safari` builds a Safari app via Xcode (macOS only)'
    )
    .option(
      '--polyfill [boolean]',
      'whether or not to apply the cross-browser polyfill. Defaults to `false`',
      parseOptionalBoolean
    )
    .option(
      '--zip [boolean]',
      'whether or not to compress the extension into a ZIP file. Defaults to `false`',
      parseOptionalBoolean
    )
    .option(
      '--zip-source [boolean]',
      'whether or not to include the source files in the ZIP file. Defaults to `false`',
      parseOptionalBoolean
    )
    .option(
      '--zip-filename <string>',
      'specify the name of the ZIP file. Defaults to the extension name and version'
    )
    .option(
      '--silent [boolean]',
      'whether or not to open the browser automatically. Defaults to `false`',
      parseOptionalBoolean
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
      '--mode <development|production|none>',
      'bundler mode override (also sets NODE_ENV). Defaults to `production`'
    )
    .option(
      '--open [boolean]',
      'open the built Safari app after packaging (safari targets only). Defaults to `false`',
      parseOptionalBoolean
    )
    .option(
      '--app-name <name>',
      'override the Safari app name (safari targets only). Defaults to the manifest `name`'
    )
    .option(
      '--bundle-id <reverse.dns>',
      'set a user-owned Safari bundle identifier (safari targets only). Defaults to a generated dev.extensionjs.* id'
    )
    .option(
      '--force-regenerate',
      'regenerate the Safari Xcode project even when up to date (safari targets only)'
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

      const list = vendors(browser)

      validateVendorsOrExit(list, (invalid, supported) => {
        // eslint-disable-next-line no-console
        console.error(messages.unsupportedBrowserFlag(invalid, supported))
      })

      // Validate --mode upfront so users get a clear error rather than a
      // silent fall-through to the production default.
      let mode: 'development' | 'production' | 'none' | undefined
      if (typeof buildOptions.mode === 'string') {
        const m = buildOptions.mode.trim().toLowerCase()
        if (m === 'development' || m === 'production' || m === 'none') {
          mode = m
        } else {
          // eslint-disable-next-line no-console
          console.error(
            `Invalid --mode value: ${JSON.stringify(buildOptions.mode)}. ` +
              `Expected one of: development, production, none.`
          )
          process.exit(1)
        }
      }

      // Safari-only options are rejected for other targets so typos don't
      // silently no-op; a malformed bundle id fails before any build.
      const safariOnlyFlags = [
        ['--open', buildOptions.open],
        ['--app-name', buildOptions.appName],
        ['--bundle-id', buildOptions.bundleId],
        ['--force-regenerate', buildOptions.forceRegenerate]
      ].filter(([, value]) => value !== undefined && value !== false)

      if (safariOnlyFlags.length > 0 && !list.some(isSafariVendor)) {
        // eslint-disable-next-line no-console
        console.error(
          messages.safariOnlyOption(
            safariOnlyFlags.map(([flag]) => flag as string)
          )
        )
        process.exit(1)
      }

      if (buildOptions.bundleId && !isValidBundleId(buildOptions.bundleId)) {
        // eslint-disable-next-line no-console
        console.error(messages.safariInvalidBundleId(buildOptions.bundleId))
        process.exit(1)
      }

      // Safari packaging preflight. Non-macOS is a warn-and-skip (the
      // web-extension bundle in dist/safari still builds and can be packaged
      // later on a Mac); a macOS host with a broken/missing Xcode is fatal.
      let safariPackagingEnabled = true
      if (list.some(isSafariVendor)) {
        const preflight = safariBuildPreflight()

        if (preflight.severity === 'fatal') {
          // eslint-disable-next-line no-console
          console.error(preflight.message)
          process.exit(1)
        }

        if (preflight.severity === 'skip') {
          safariPackagingEnabled = false
          // eslint-disable-next-line no-console
          console.warn(preflight.message)
        }
      }

      const {extensionBuild}: {extensionBuild: any} =
        await loadExtensionDevelopModule()

      for (const vendor of list) {
        await extensionBuild(pathOrRemoteUrl, {
          browser: vendor as BuildOptions['browser'],
          // CLI surface: a failed build ends this process with the clean
          // error line. Library imports of extensionBuild reject instead.
          exitOnError: true,
          polyfill: buildOptions.polyfill,
          zip: buildOptions.zip,
          zipSource: buildOptions.zipSource,
          zipFilename: buildOptions.zipFilename,
          silent: buildOptions.silent,
          install: buildOptions.install,
          extensions: parseExtensionsList((buildOptions as any).extensions),
          mode,
          appName: buildOptions.appName,
          bundleId: buildOptions.bundleId,
          forceRegenerate: buildOptions.forceRegenerate,
          safariPackager: safariPackagingEnabled
            ? async (
                distPath: string,
                packagerMode: 'full' | 'resync',
                overrides?: Record<string, unknown>
              ) => {
                await packageSafariExtension(
                  {
                    extension: [distPath],
                    browser: vendor as Browser,
                    // build is a packaging command: never open the app unless
                    // explicitly asked (--open). dev keeps open-by-default.
                    noOpen: buildOptions.open !== true,
                    dryRun: false,
                    ...overrides
                  },
                  distPath,
                  undefined,
                  packagerMode
                )
              }
            : undefined
        })
      }
    })
}
