//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {type Command, Option} from 'commander'
import {safariBuildPreflight} from '../browsers/run-safari/safari-launch'
import {isValidBundleId} from '../browsers/run-safari/safari-launch/safari-config'
import {createSafariPackager} from '../browsers/run-safari/safari-packager'
import {loadExtensionDevelopModule} from '../helpers/extension-develop-runtime'
import * as messages from '../helpers/messages'
import {commandDescriptions} from '../helpers/messages'
import {CODES, ENVELOPE} from '../helpers/messaging'
import {parseExtensionsList} from '../helpers/normalize-options'
import {
  type Browser,
  isSafariVendor,
  parseOptionalBoolean,
  validateVendors,
  vendors
} from '../helpers/vendors'

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
  macosOnly?: boolean
  forceRegenerate?: boolean
  debug?: boolean
  output?: 'pretty' | 'json'
  author?: boolean
  authorMode?: boolean
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
    .option('--no-polyfill', 'disable the cross-browser polyfill')
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
      'suppress the build summary output. Defaults to `false`',
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
      '--macos-only [boolean]',
      'generate a macOS-only Safari Xcode project (safari targets only). Pass `false` for a universal macOS + iOS project. Defaults to `true`',
      parseOptionalBoolean
    )
    .option(
      '--force-regenerate',
      'regenerate the Safari Xcode project even when up to date (safari targets only)'
    )
    .option(
      '--output <pretty|json>',
      'result format. Use json for a schema-1 envelope on stdout'
    )
    .addOption(
      new Option(
        '--debug',
        'print maintainer diagnostics alongside normal output'
      )
    )
    .addOption(
      new Option(
        '--author, --author-mode',
        'deprecated alias for --debug'
      ).hideHelp()
    )
    .action(
      async (
        pathOrRemoteUrl: string,
        {browser = 'chromium', ...buildOptions}: BuildOptions
      ) => {
        if (
          buildOptions.debug ||
          buildOptions.author ||
          buildOptions.authorMode
        ) {
          process.env.EXTENSION_DEBUG = '1'
          // Alias kept for one minor: extension-develop still reads the old name.
          process.env.EXTENSION_AUTHOR_MODE = 'true'
          if (!process.env.EXTENSION_VERBOSE)
            process.env.EXTENSION_VERBOSE = '1'
        }

        const list = vendors(browser)

        const vendorsAreSupported = validateVendors(
          list,
          (invalid, supported) => {
            // eslint-disable-next-line no-console
            console.error(messages.unsupportedBrowserFlag(invalid, supported))
          }
        )

        if (!vendorsAreSupported) process.exit(1)

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
        ]
          .filter(([, value]) => value !== undefined && value !== false)
          .map(([flag]) => flag as string)

        // --macos-only carries an explicit boolean, so `false` is a real use
        // rather than an unset flag; only `undefined` means it was not passed.
        if (buildOptions.macosOnly !== undefined) {
          safariOnlyFlags.push('--macos-only')
        }

        if (safariOnlyFlags.length > 0 && !list.some(isSafariVendor)) {
          // eslint-disable-next-line no-console
          console.error(messages.safariOnlyOption(safariOnlyFlags))
          process.exit(1)
        }

        if (buildOptions.bundleId && !isValidBundleId(buildOptions.bundleId)) {
          // eslint-disable-next-line no-console
          console.error(messages.safariInvalidBundleId(buildOptions.bundleId))
          process.exit(1)
        }

        // Safari packaging preflight. Non-macOS is a warn-and-skip; a macOS
        // host with a broken/missing Xcode is fatal.
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

        const {extensionBuild} = await loadExtensionDevelopModule()
        const asJson = buildOptions.output === 'json'
        // Tells develop to route human lines to stderr, so stdout carries
        // only the envelope and stays parseable as one JSON document.
        if (asJson) process.env.EXTENSION_OUTPUT = 'json'
        const built: string[] = []
        const summaries: unknown[] = []

        for (const vendor of list) {
          try {
            const summary = await extensionBuild(pathOrRemoteUrl, {
              browser: vendor as BuildOptions['browser'],
              // CLI surface: a failed build ends this process with the clean
              // error line. Library imports of extensionBuild reject instead.
              // Under --output json we catch instead, so the failure can be
              // reported as one envelope rather than a bare exit code.
              exitOnError: !asJson,
              polyfill: buildOptions.polyfill,
              zip: buildOptions.zip,
              zipSource: buildOptions.zipSource,
              zipFilename: buildOptions.zipFilename,
              silent: buildOptions.silent,
              install: buildOptions.install,
              extensions: parseExtensionsList(buildOptions.extensions),
              mode,
              appName: buildOptions.appName,
              bundleId: buildOptions.bundleId,
              macOsOnly: buildOptions.macosOnly,
              forceRegenerate: buildOptions.forceRegenerate,
              safariPackager: safariPackagingEnabled
                ? createSafariPackager({
                    browser: vendor as 'safari' | 'webkit-based',
                    // build is a packaging command: never open the app unless
                    // explicitly asked (--open). dev keeps open-by-default.
                    noOpen: buildOptions.open !== true
                  })
                : undefined
            })

            built.push(vendor)
            if (summary) summaries.push(summary)
          } catch (error) {
            if (!asJson) throw error

            // eslint-disable-next-line no-console
            console.log(
              JSON.stringify(
                ENVELOPE.fail(
                  'build',
                  'build-failed',
                  {
                    code: CODES.E_COMPILE,
                    message:
                      error instanceof Error ? error.message : String(error)
                  },
                  {hint: `Fix the error above and run build again.`}
                )
              )
            )
            process.exit(1)
          }
        }

        if (asJson) {
          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify(
              // `summaries` carries what the pretty run only printed: output
              // path, asset totals, warning text and the Safari app identity.
              // Without it a machine caller has to scrape the human summary.
              ENVELOPE.ok('build', 'built', {
                projectPath: pathOrRemoteUrl,
                browsers: built,
                mode,
                summaries
              })
            )
          )
        }
      }
    )
}
