//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import {type Command, Option} from 'commander'
import {
  SAFARI_APP_ICON_HELP,
  SAFARI_DEVELOPMENT_TEAM_HELP
} from '../browsers/browsers-lib/messages'
import {safariBuildPreflight} from '../browsers/run-safari/safari-launch'
import {createSafariPackager} from '../browsers/run-safari/safari-packager'
import {refuseUnlistedChoices} from '../helpers/choice-flags'
import {declaredErrorCode} from '../helpers/cli-failure'
import {getCliPackageJson} from '../helpers/cli-package-json'
import {resolveConfigBrowser} from '../helpers/config-browser'
import {exitWithFailure} from '../helpers/exit-after-drain'
import {
  type DevelopBrowser,
  type DevelopFor,
  type DevelopModule,
  loadExtensionDevelopModule
} from '../helpers/extension-develop-runtime'
import * as messages from '../helpers/messages'
import {commandDescriptions} from '../helpers/messages'
import {
  CODES,
  type Diagnostic,
  ENVELOPE,
  type ErrorCode
} from '../helpers/messaging'
import {
  isReverseDnsBundleId,
  parseExtensionsList
} from '../helpers/normalize-options'
import {isJsonOutput, refuseUnreadableOutput} from '../helpers/output-flag'
import {checkProjectCliVersion} from '../helpers/project-cli-version'
import {
  missingProjectFolder,
  missingProjectRefusal
} from '../helpers/project-folder'
import {
  noteRunBrowsers,
  reportCommandFailureNow
} from '../helpers/telemetry-cli'
import {
  BROWSER_TARGETS_HELP,
  type Browser,
  isSafariVendor,
  parseOptionalBoolean,
  unsupportedBrowserMessage,
  validateVendors,
  vendors
} from '../helpers/vendors'

export type BuildOptions = {
  browser?: Browser | 'all'
  polyfill?: boolean
  zip?: boolean
  zipSource?: boolean
  zipFilename?: string
  zipDir?: string
  sourceMaps?: boolean
  outDir?: string
  silent?: boolean
  addonLint?: boolean
  minify?: boolean
  install?: boolean
  extensions?: string
  mode?: string
  open?: boolean
  appName?: string
  bundleId?: string
  developmentTeam?: string
  macosOnly?: boolean
  appIcon?: string
  forceRegenerate?: boolean
  debug?: boolean
  output?: 'pretty' | 'json'
  authorMode?: boolean
}

// Under --output json a bare exit leaves stdout empty, so a machine consumer
// reads exit 1 and has nothing to explain it. Print the frame before exiting.
function failAndExitWith(
  reportFailure: typeof reportCommandFailureNow,
  asJson: boolean,
  status: string,
  error: {code: ErrorCode; message: string},
  hint?: string
): never {
  if (asJson) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(ENVELOPE.fail('build', status, error, hint ? {hint} : {}))
    )
  }

  exitWithFailure(error.code, 1, reportFailure)
}

// What the action reaches outside this file. Production takes every default.
interface BuildCommandDeps {
  loadDevelop?: () => Promise<DevelopModule>
  safariPreflight?: typeof safariBuildPreflight
  createPackager?: typeof createSafariPackager
  noteBrowsers?: typeof noteRunBrowsers
  reportFailure?: typeof reportCommandFailureNow
}

export function registerBuildCommand(
  program: Command,
  {
    loadDevelop = loadExtensionDevelopModule,
    safariPreflight = safariBuildPreflight,
    createPackager = createSafariPackager,
    noteBrowsers = noteRunBrowsers,
    reportFailure = reportCommandFailureNow
  }: BuildCommandDeps = {}
) {
  const failAndExit: (
    asJson: boolean,
    status: string,
    error: {code: ErrorCode; message: string},
    hint?: string
  ) => never = (...args) => failAndExitWith(reportFailure, ...args)

  program
    .command('build')
    .arguments('[project-name]')
    .usage('[path-to-remote-extension] [options]')
    .description(commandDescriptions.build)
    .option(
      `--browser <${BROWSER_TARGETS_HELP}>`,
      'specify a browser/engine to run. Defaults to `chromium`. `safari` builds a Safari app via Xcode (macOS only)'
    )
    .option(
      '--polyfill [boolean]',
      'bundle the cross-browser polyfill, for a Chromium older than 148 (152 with a devtools_page). Defaults to `false`',
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
      'specify the name of the ZIP file, the browser name is appended. Defaults to the extension name and version'
    )
    .option(
      '--zip-dir <path>',
      'write the ZIP files to this folder, relative to the project root or absolute. Defaults to the folder that holds the browser output, `dist`'
    )
    .option(
      '--source-maps [boolean]',
      'write a source map beside each script and stylesheet of a production build. The maps stay out of the ZIP file. Defaults to `false`',
      parseOptionalBoolean
    )
    .option(
      '--out-dir <path>',
      'write the build to `<path>/<browser>` instead of `dist/<browser>`, relative to the project root, so it can run beside a dev session that serves `dist`'
    )
    .option(
      '--silent [boolean]',
      'print nothing on a build that succeeds. Warnings stay in `build-summary.json`, errors still print. Defaults to `false`',
      parseOptionalBoolean
    )
    .option(
      '--addon-lint [boolean]',
      'check Firefox builds against addons.mozilla.org rules with addons-linter when it is installed. Findings print as warnings. Defaults to `true`',
      parseOptionalBoolean
    )
    .option(
      '--no-addon-lint',
      'skip the addons.mozilla.org lint of Firefox builds'
    )
    .option(
      '--minify [boolean]',
      'minify first-party code in production builds. Defaults to `true`, and to `false` for `opera`, whose store rejects minified code',
      parseOptionalBoolean
    )
    .option(
      '--no-minify',
      'ship readable first-party code, the Opera Add-ons review requirement'
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
      'bundler mode override (also sets NODE_ENV, except `none`). Defaults to `production`'
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
      'set a user-owned Safari bundle identifier (safari targets only). Defaults to a generated dev.extensionjs.* id shared by every build of the same source, so set your own before the first submission'
    )
    .option('--development-team <id>', SAFARI_DEVELOPMENT_TEAM_HELP)
    .option(
      '--macos-only [boolean]',
      'generate a macOS-only Safari Xcode project (safari targets only). Pass `false` for a universal macOS + iOS project. Defaults to `true`',
      parseOptionalBoolean
    )
    .option('--app-icon <path>', SAFARI_APP_ICON_HELP)
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
    .hook('preAction', refuseUnreadableOutput({reportFailure}))
    .hook('preAction', refuseUnlistedChoices({reportFailure}))
    .action(
      async (
        pathOrRemoteUrl: string,
        {browser: cliBrowser, ...buildOptions}: BuildOptions
      ) => {
        // Only an untyped --browser falls through to extension.config.js
        // commands.build.browser, then the stock chromium default.
        const browser =
          cliBrowser ??
          ((await resolveConfigBrowser(
            pathOrRemoteUrl || process.cwd(),
            'build',
            loadDevelop
          )) as BuildOptions['browser']) ??
          'chromium'

        if (buildOptions.debug || buildOptions.authorMode) {
          process.env.EXTENSION_DEBUG = '1'
          // Alias kept for one minor: extension-develop still reads the old name.
          process.env.EXTENSION_AUTHOR_MODE = 'true'

          if (!process.env.EXTENSION_VERBOSE) {
            process.env.EXTENSION_VERBOSE = '1'
          }
        }

        const asJson = isJsonOutput(buildOptions)
        const list = vendors(browser)
        noteBrowsers(list)
        let unsupportedBrowser = ''
        let supportedBrowsers: string[] = []

        const vendorsAreSupported = validateVendors(
          list,
          (invalid, supported) => {
            unsupportedBrowser = invalid
            supportedBrowsers = supported
            // The frame names the choices, so json mode needs no prose.
            if (asJson) return

            // eslint-disable-next-line no-console
            console.error(messages.unsupportedBrowserFlag(invalid, supported))
          }
        )

        if (!vendorsAreSupported) {
          failAndExit(asJson, 'usage', {
            code: CODES.E_UNSUPPORTED_BROWSER,
            message: unsupportedBrowserMessage(
              unsupportedBrowser,
              supportedBrowsers
            )
          })
        }

        // The preAction hook already refused a --mode off its list, so this
        // only folds case and spaces the way that check reads them.
        const mode = buildOptions.mode?.trim().toLowerCase() as
          | 'development'
          | 'production'
          | 'none'
          | undefined

        // Safari-only options are rejected for other targets so typos don't
        // silently no-op; a malformed bundle id fails before any build.
        const safariOnlyFlags = [
          ['--open', buildOptions.open],
          ['--app-name', buildOptions.appName],
          ['--bundle-id', buildOptions.bundleId],
          ['--development-team', buildOptions.developmentTeam],
          ['--app-icon', buildOptions.appIcon],
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
          if (!asJson) {
            // eslint-disable-next-line no-console
            console.error(messages.safariOnlyOption(safariOnlyFlags))
          }

          failAndExit(asJson, 'usage', {
            code: CODES.E_INVALID_OPTION,
            message: messages.safariOnlyOptionPlain(safariOnlyFlags)
          })
        }

        if (
          buildOptions.bundleId !== undefined &&
          !isReverseDnsBundleId(buildOptions.bundleId)
        ) {
          const message = messages.invalidBundleId(buildOptions.bundleId)

          if (!asJson) {
            // eslint-disable-next-line no-console
            console.error(messages.usageRefusal(message))
          }

          failAndExit(asJson, 'usage', {code: CODES.E_INVALID_OPTION, message})
        }

        const missingFolder = missingProjectFolder(pathOrRemoteUrl)

        if (missingFolder) {
          const refusal = missingProjectRefusal('build', missingFolder)

          // eslint-disable-next-line no-console
          if (!asJson) console.error(refusal.stderr)

          failAndExit(
            asJson,
            'usage',
            {code: CODES.E_PROJECT_NOT_FOUND, message: refusal.message},
            refusal.hint
          )
        }

        // Safari packaging preflight. Non-macOS is a warn-and-skip; a macOS
        // host with a broken/missing Xcode is fatal.
        let safariPackagingEnabled = true

        if (list.some(isSafariVendor)) {
          const preflight = safariPreflight()

          if (preflight.severity === 'fatal') {
            if (!asJson) {
              // eslint-disable-next-line no-console
              console.error(preflight.message)
            }

            failAndExit(asJson, 'failed', {
              code: CODES.E_SAFARI_TOOLCHAIN,
              message: String(preflight.message)
            })
          }

          if (preflight.severity === 'skip') {
            safariPackagingEnabled = false
            // eslint-disable-next-line no-console
            console.warn(preflight.message)
          }
        }

        const {extensionBuild}: DevelopFor<'extensionBuild'> =
          await loadDevelop()

        const cliVersion = checkProjectCliVersion(
          path.resolve(pathOrRemoteUrl || process.cwd()),
          getCliPackageJson().version as string
        )

        if (cliVersion) {
          // eslint-disable-next-line no-console
          console.warn(
            messages.projectCliVersionMismatch(
              cliVersion.running,
              cliVersion.declared,
              cliVersion.range,
              cliVersion.command
            )
          )
        }

        // Tells develop to route human lines to stderr, so stdout carries
        // only the envelope and stays parseable as one JSON document.
        if (asJson) process.env.EXTENSION_OUTPUT = 'json'

        const built: string[] = []
        const summaries: unknown[] = []

        for (const vendor of list) {
          try {
            const summary = await extensionBuild(pathOrRemoteUrl, {
              browser: vendor as DevelopBrowser,
              polyfill: buildOptions.polyfill,
              zip: buildOptions.zip,
              zipSource: buildOptions.zipSource,
              zipFilename: buildOptions.zipFilename,
              zipDir: buildOptions.zipDir,
              sourceMaps: buildOptions.sourceMaps,
              outDir: buildOptions.outDir,
              silent: buildOptions.silent,
              addonLint: buildOptions.addonLint,
              minify: buildOptions.minify,
              install: buildOptions.install,
              extensions: parseExtensionsList(buildOptions.extensions),
              mode,
              appName: buildOptions.appName,
              bundleId: buildOptions.bundleId,
              developmentTeam: buildOptions.developmentTeam,
              macOsOnly: buildOptions.macosOnly,
              appIcon: buildOptions.appIcon,
              forceRegenerate: buildOptions.forceRegenerate,
              safariPackager: safariPackagingEnabled
                ? createPackager({
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
            const code = declaredErrorCode(error) ?? CODES.E_COMPILE

            // The engine printed the failure before it rejected, so pretty
            // mode adds no line and only the frame is left to write.
            if (asJson) {
              // The engine lists each diagnostic behind the failure on the
              // error it rejects with, and the frame carries them as details.
              const {diagnostics, truncated} = (error ?? {}) as {
                diagnostics?: Diagnostic[]
                truncated?: boolean
              }

              // eslint-disable-next-line no-console
              console.log(
                JSON.stringify(
                  ENVELOPE.fail(
                    'build',
                    'build-failed',
                    {
                      code,
                      message:
                        error instanceof Error ? error.message : String(error),
                      ...(Array.isArray(diagnostics) && diagnostics.length > 0
                        ? {details: diagnostics}
                        : {})
                    },
                    {
                      hint: `Fix the error above and run build again.`,
                      truncated: truncated === true,
                      // A failed build lists the warnings it got past as a green
                      // one does, the earlier browsers' and its own, once each.
                      warnings: codedWarningsOf([...summaries, error]),
                      // A list that stops partway says what dist already holds
                      // and which browser stopped it. One browser needs neither.
                      ...(list.length > 1
                        ? {
                            browser: vendor,
                            value: {
                              projectPath: pathOrRemoteUrl,
                              browsers: built,
                              mode: mode ?? 'production',
                              summaries
                            }
                          }
                        : {})
                    }
                  )
                )
              )
            }

            exitWithFailure(code, 1, reportFailure)
          }
        }

        if (asJson) {
          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify(
              // `summaries` carries what the pretty run only printed: output
              // path, asset totals, warning text and the Safari app identity.
              // Without it a machine caller has to scrape the human summary.
              ENVELOPE.ok(
                'build',
                'built',
                {
                  projectPath: pathOrRemoteUrl,
                  browsers: built,
                  // The frame records the mode the build resolved to, so the
                  // key survives the default invocation with no --mode flag.
                  mode: mode ?? 'production',
                  summaries
                },
                {warnings: codedWarningsOf(summaries)}
              )
            )
          )
        }
      }
    )
}

// A summary warning that opens with a declared code is one the run carried
// on past, and the frame's own warnings array is where a consumer reads it.
function codedWarningsOf(summaries: unknown[]): string[] {
  const coded: string[] = []

  for (const summary of summaries) {
    const warnings = (summary as {warnings?: unknown} | null)?.warnings
    if (!Array.isArray(warnings)) continue

    for (const line of warnings) {
      if (typeof line !== 'string') continue

      const code = line.slice(0, line.indexOf(': '))

      if (
        code.startsWith('W_') &&
        Object.prototype.hasOwnProperty.call(CODES, code) &&
        !coded.includes(line)
      ) {
        coded.push(line)
      }
    }
  }

  return coded
}
