#!/usr/bin/env node

// ███████╗██╗  ██╗████████╗███████╗███╗   ██╗███████╗██╗ ██████╗ ███╗   ██╗        ██╗███████╗
// ██╔════╝╚██╗██╔╝╚══██╔══╝██╔════╝████╗  ██║██╔════╝██║██╔═══██╗████╗  ██║        ██║██╔════╝
// █████╗   ╚███╔╝    ██║   █████╗  ██╔██╗ ██║███████╗██║██║   ██║██╔██╗ ██║        ██║███████╗
// ██╔══╝   ██╔██╗    ██║   ██╔══╝  ██║╚██╗██║╚════██║██║██║   ██║██║╚██╗██║   ██   ██║╚════██║
// ███████╗██╔╝ ██╗   ██║   ███████╗██║ ╚████║███████║██║╚██████╔╝██║ ╚████║██╗╚█████╔╝███████║
// ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═══╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝ ╚════╝ ╚══════╝

import {program} from 'commander'
import {extensionCreate, type CreateOptions} from 'extension-create'
import type {
  DevOptions,
  StartOptions,
  BuildOptions,
  PreviewOptions
} from 'extension-develop'
import * as messages from './cli-lib/messages'
import checkUpdates from './check-updates'
import packageJson from './package.json'
import {telemetry} from './cli-lib/telemetry-cli'

export type {FileConfig, Manifest} from 'extension-develop'

function parseOptionalBoolean(value?: string): boolean {
  // No value provided means flag present => true
  if (typeof value === 'undefined') return true
  // Treat "false", "0", and "no" (case-insensitive) as false; everything else true
  const normalized = String(value).trim().toLowerCase()
  return !['false', '0', 'no', 'off'].includes(normalized)
}

// Before all, check for updates.
checkUpdates(packageJson)

const extensionJs = program

//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝

const vendors = (browser: DevOptions['browser'] | 'all') =>
  browser === 'all' ? 'chrome,edge,firefox'.split(',') : browser.split(',')

function validateVendorsOrExit(vendorsList: string[]) {
  const supported = ['chrome', 'edge', 'firefox']
  for (const v of vendorsList) {
    if (!supported.includes(v)) {
      // eslint-disable-next-line no-console
      console.error(messages.unsupportedBrowserFlag(v, supported))
      process.exit(1)
    }
  }
}

// telemetry boot, manifest summary, and process handlers are initialized in cli-lib/telemetry-cli

extensionJs
  .name(packageJson.name)
  .description(packageJson.description)
  .version(packageJson.version)
  .option('--no-telemetry', 'disable anonymous telemetry for this run')
  .option('--ai-help', 'show AI-assistant oriented help and tips')
  .addHelpText('after', messages.programUserHelp())

//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

extensionJs
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

// ██████╗ ███████╗██╗   ██╗
// ██╔══██╗██╔════╝██║   ██║
// ██║  ██║█████╗  ██║   ██║
// ██║  ██║██╔══╝  ╚██╗ ██╔╝
// ██████╔╝███████╗ ╚████╔╝
// ╚═════╝ ╚══════╝  ╚═══╝

extensionJs
  .command('dev')
  .arguments('[project-path|remote-url]')
  .usage('dev [project-path|remote-url] [options]')
  .description('Starts the development server (development mode)')
  .option(
    '--profile <path-to-file | boolean>',
    'what path to use for the browser profile. A boolean value of false sets the profile to the default user profile. Defaults to a fresh profile'
  )
  .option(
    '--browser <chrome | edge | firefox>',
    'specify a browser to preview your extension in production mode. Defaults to `chrome`'
  )
  .option(
    '--chromium-binary <path-to-binary>',
    'specify a path to the Chromium binary. This option overrides the --browser setting. Defaults to the system default'
  )
  .option(
    '--gecko-binary <path-to-binary>',
    'specify a path to the Gecko binary. This option overrides the --browser setting. Defaults to the system default'
  )
  .option(
    '--polyfill [boolean]',
    'whether or not to apply the cross-browser polyfill. Defaults to `false`'
  )
  .option(
    '--open [boolean]',
    'whether or not to open the browser automatically. Defaults to `true`'
  )
  .option(
    '--starting-url <url>',
    'specify the starting URL for the browser. Defaults to `undefined`'
  )
  .option(
    '--port <port>',
    'specify the port to use for the development server. Defaults to `8080`'
  )
  .option(
    '--logs <off|error|warn|info|debug|trace|all>',
    'filter unified logger events sent to CLI. Use `all` to show everything. Defaults to `info`'
  )
  .option(
    '--log-context <list>',
    'comma-separated contexts to include (background,content,page,sidebar,popup,options,devtools). Use `all` to include all contexts (default)'
  )
  .option(
    '--log-format <pretty|json>',
    'output format for logger events. Defaults to `pretty`'
  )
  .option('--no-log-timestamps', 'disable ISO timestamps in pretty output')
  .option('--no-log-color', 'disable color in pretty output')
  .option(
    '--log-url <pattern>',
    'only show logs where event.url matches this substring or regex (/re/i)'
  )
  .option('--log-tab <id>', 'only show logs for a specific tabId (number)')
  .option(
    '--source [url]',
    'opens the provided URL in Chrome and prints the full, live HTML of the page after content scripts are injected'
  )
  .option(
    '--watch-source',
    'continuously monitors rebuild events and prints updated HTML whenever the extension reloads and reinjects into the page'
  )
  .action(async function (
    pathOrRemoteUrl: string,
    {browser = 'chrome', ...devOptions}: DevOptions
  ) {
    const cmdStart = Date.now()
    // command start snapshot
    telemetry.track('cli_command_start', {
      command: 'dev',
      vendors: vendors(browser),
      polyfill_used: devOptions.polyfill?.toString() === 'false' ? false : true,
      log_level: devOptions.logLevel || 'off',
      log_format: devOptions.logFormat || 'pretty',
      custom_binary_used: Boolean(
        devOptions.chromiumBinary || devOptions.geckoBinary
      )
    })

    const list = vendors(browser)
    validateVendorsOrExit(list)

    // Enforce: --source/--watch-source require --starting-url
    if (devOptions.source || devOptions.watchSource) {
      const hasExplicitSourceString =
        typeof devOptions.source === 'string' &&
        String(devOptions.source).trim().toLowerCase() !== 'true'

      const hasStartingUrl =
        typeof devOptions.startingUrl === 'string' &&
        String(devOptions.startingUrl).trim().length > 0

      if (!hasExplicitSourceString && !hasStartingUrl) {
        process.exit(1)
      }
    }

    const {extensionDev} = await import('extension-develop')
    for (const vendor of list) {
      const vendorStart = Date.now()
      telemetry.track('cli_vendor_start', {command: 'dev', vendor})
      // Map CLI flags to internal logger fields
      const logsOption = (devOptions as unknown as {logs?: string}).logs
      const logContextOption = (devOptions as unknown as {logContext?: string})
        .logContext

      const devArgs: any = {
        ...devOptions,
        profile: devOptions.profile,
        browser: vendor as DevOptions['browser'],
        chromiumBinary: devOptions.chromiumBinary,
        geckoBinary: devOptions.geckoBinary,
        polyfill: devOptions.polyfill?.toString() === 'false' ? false : true,
        open: devOptions.open,
        startingUrl: devOptions.startingUrl,
        source: devOptions.source,
        watchSource: devOptions.watchSource,
        // Unified logger options (not part of DevOptions type):
        // Default to 'off' unless user explicitly opts in via --logs
        logLevel: (logsOption || devOptions.logLevel || 'off') as any,
        logContexts: (() => {
          const raw = (logContextOption || (devOptions as any).logContexts) as
            | string
            | undefined
          if (!raw || String(raw).trim().length === 0) return undefined
          if (String(raw).trim().toLowerCase() === 'all') return undefined
          const allowed = [
            'background',
            'content',
            'page',
            'sidebar',
            'popup',
            'options',
            'devtools'
          ] as const
          type Context = (typeof allowed)[number]
          const values = String(raw)
            .split(',')
            .map((s: string) => s.trim())
            .filter((s: string) => s.length > 0)
            .filter((c: string): c is Context =>
              (allowed as readonly string[]).includes(c)
            )
          return values.length ? values : undefined
        })(),
        logFormat: devOptions.logFormat || 'pretty',
        logTimestamps: devOptions.logTimestamps !== false,
        logColor: devOptions.logColor !== false,
        logUrl: devOptions.logUrl,
        logTab: devOptions.logTab
      }

      await extensionDev(pathOrRemoteUrl, devArgs)

      telemetry.track('cli_vendor_finish', {
        command: 'dev',
        vendor,
        duration_ms: Date.now() - vendorStart
      })
    }

    telemetry.track('cli_command_finish', {
      command: 'dev',
      duration_ms: Date.now() - cmdStart,
      success: process.exitCode === 0 || process.exitCode == null,
      exit_code: process.exitCode ?? 0
    })
  })

// ███████╗████████╗ █████╗ ██████╗ ████████╗
// ██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚══██╔══╝
// ███████╗   ██║   ███████║██████╔╝   ██║
// ╚════██║   ██║   ██╔══██║██╔══██╗   ██║
// ███████║   ██║   ██║  ██║██║  ██║   ██║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝

extensionJs
  .command('start')
  .arguments('[project-path|remote-url]')
  .usage('start [project-path|remote-url] [options]')
  .description('Starts the development server (production mode)')
  .option(
    '--profile <path-to-file | boolean>',
    'what path to use for the browser profile. A boolean value of false sets the profile to the default user profile. Defaults to a fresh profile'
  )
  .option(
    '--browser <chrome | edge | firefox>',
    'specify a browser to preview your extension in production mode. Defaults to `chrome`'
  )
  .option(
    '--polyfill [boolean]',
    'whether or not to apply the cross-browser polyfill. Defaults to `true`'
  )
  .option(
    '--chromium-binary <path-to-binary>',
    'specify a path to the Chromium binary. This option overrides the --browser setting. Defaults to the system default'
  )
  .option(
    '--gecko-binary <path-to-binary>',
    'specify a path to the Gecko binary. This option overrides the --browser setting. Defaults to the system default'
  )
  .option(
    '--starting-url <url>',
    'specify the starting URL for the browser. Defaults to `undefined`'
  )
  .option(
    '--port <port>',
    'specify the port to use for the development server. Defaults to `8080`'
  )
  .action(async function (
    pathOrRemoteUrl: string,
    {browser = 'chrome', ...startOptions}: StartOptions
  ) {
    const cmdStart = Date.now()
    telemetry.track('cli_command_start', {
      command: 'start',
      vendors: vendors(browser),
      polyfill_used: startOptions.polyfill?.toString() !== 'false'
    })

    const list = vendors(browser)
    validateVendorsOrExit(list)

    const {extensionStart} = await import('extension-develop')
    for (const vendor of list) {
      const vendorStart = Date.now()
      telemetry.track('cli_vendor_start', {command: 'start', vendor})

      await extensionStart(pathOrRemoteUrl, {
        mode: 'production',
        profile: startOptions.profile,
        browser: vendor as StartOptions['browser'],
        chromiumBinary: startOptions.chromiumBinary,
        geckoBinary: startOptions.geckoBinary,
        startingUrl: startOptions.startingUrl
      })

      telemetry.track('cli_vendor_finish', {
        command: 'start',
        vendor,
        duration_ms: Date.now() - vendorStart
      })
    }

    telemetry.track('cli_command_finish', {
      command: 'start',
      duration_ms: Date.now() - cmdStart,
      success: process.exitCode === 0 || process.exitCode == null,
      exit_code: process.exitCode ?? 0
    })
  })

// ██████╗ ██████╗ ███████╗██╗   ██╗██╗███████╗██╗    ██╗
// ██╔══██╗██╔══██╗██╔════╝██║   ██║██║██╔════╝██║    ██║
// ██████╔╝██████╔╝█████╗  ██║   ██║██║█████╗  ██║ █╗ ██║
// ██╔═══╝ ██╔══██╗██╔══╝  ╚██╗ ██╔╝██║██╔══╝  ██║███╗██║
// ██║     ██║  ██║███████╗ ╚████╔╝ ██║███████╗╚███╔███╔╝
// ╚═╝     ╚═╝  ╚═╝╚══════╝  ╚═══╝  ╚═╝╚══════╝ ╚══╝╚══╝

extensionJs
  .command('preview')
  .arguments('[project-name]')
  .usage('preview [path-to-remote-extension] [options]')
  .description('Preview the extension in production mode')
  .option(
    '--profile <path-to-file | boolean>',
    'what path to use for the browser profile. A boolean value of false sets the profile to the default user profile. Defaults to a fresh profile'
  )
  .option(
    '--browser <chrome | edge | firefox>',
    'specify a browser to preview your extension in production mode. Defaults to `chrome`'
  )
  .option(
    '--chromium-binary <path-to-binary>',
    'specify a path to the Chromium binary. This option overrides the --browser setting. Defaults to the system default'
  )
  .option(
    '--gecko-binary <path-to-binary>',
    'specify a path to the Gecko binary. This option overrides the --browser setting. Defaults to the system default'
  )
  .option(
    '--starting-url <url>',
    'specify the starting URL for the browser. Defaults to `undefined`'
  )
  .option(
    '--port <port>',
    'specify the port to use for the development server. Defaults to `8080`'
  )
  .action(async function (
    pathOrRemoteUrl: string,
    {browser = 'chrome', ...previewOptions}: PreviewOptions
  ) {
    const cmdStart = Date.now()
    telemetry.track('cli_command_start', {
      command: 'preview',
      vendors: vendors(browser)
    })

    const list = vendors(browser)
    validateVendorsOrExit(list)

    const {extensionPreview} = await import('extension-develop')
    for (const vendor of list) {
      const vendorStart = Date.now()
      telemetry.track('cli_vendor_start', {command: 'preview', vendor})

      await extensionPreview(pathOrRemoteUrl, {
        mode: 'production',
        profile: previewOptions.profile,
        browser: vendor as PreviewOptions['browser'],
        chromiumBinary: previewOptions.chromiumBinary,
        geckoBinary: previewOptions.geckoBinary,
        startingUrl: previewOptions.startingUrl
      })
      telemetry.track('cli_vendor_finish', {
        command: 'preview',
        vendor,
        duration_ms: Date.now() - vendorStart
      })
    }

    telemetry.track('cli_command_finish', {
      command: 'preview',
      duration_ms: Date.now() - cmdStart,
      success: process.exitCode === 0 || process.exitCode == null,
      exit_code: process.exitCode ?? 0
    })
  })

// ██████╗ ██╗   ██╗██╗██╗     ██████╗
// ██╔══██╗██║   ██║██║██║     ██╔══██╗
// ██████╔╝██║   ██║██║██║     ██║  ██║
// ██╔══██╗██║   ██║██║██║     ██║  ██║
// ██████╔╝╚██████╔╝██║███████╗██████╔╝
// ╚═════╝  ╚═════╝ ╚═╝╚══════╝╚═════╝

extensionJs
  .command('build')
  .arguments('[project-name]')
  .usage('build [path-to-remote-extension] [options]')
  .description('Builds the extension for production')
  .option(
    '--browser <chrome | edge | firefox>',
    'specify a browser to preview your extension in production mode. Defaults to `chrome`'
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
  .action(async function (
    pathOrRemoteUrl: string,
    {browser = 'chrome', ...buildOptions}: BuildOptions
  ) {
    const cmdStart = Date.now()
    telemetry.track('cli_command_start', {
      command: 'build',
      vendors: vendors(browser),
      polyfill_used: buildOptions.polyfill || false,
      zip: buildOptions.zip || false,
      zip_source: buildOptions.zipSource || false
    })

    const list = vendors(browser)
    validateVendorsOrExit(list)

    const {extensionBuild} = await import('extension-develop')
    for (const vendor of list) {
      const vendorStart = Date.now()
      telemetry.track('cli_vendor_start', {command: 'build', vendor})

      const buildSummary = await extensionBuild(pathOrRemoteUrl, {
        browser: vendor as BuildOptions['browser'],
        polyfill: buildOptions.polyfill,
        zip: buildOptions.zip,
        zipSource: buildOptions.zipSource,
        zipFilename: buildOptions.zipFilename,
        silent: buildOptions.silent
      })
      telemetry.track('cli_build_summary', {
        ...buildSummary
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
      exit_code: process.exitCode ?? 0
    })
  })

// Print AI-focused help and exit when --ai-help is provided
extensionJs.on('option:ai-help', function () {
  // eslint-disable-next-line no-console
  console.log(messages.programAIHelp())
  process.exit(0)
})

extensionJs.parse()
