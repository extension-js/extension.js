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
  PreviewOptions,
  FileConfig,
  Manifest
} from 'extension-develop'
import * as messages from './cli-lib/messages'
import checkUpdates from './check-updates'
import packageJson from './package.json'

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

extensionJs
  .name(packageJson.name)
  .description(packageJson.description)
  .version(packageJson.version)
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
    await extensionCreate(pathOrRemoteUrl, {
      template,
      install,
      cliVersion: packageJson.version
    })
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
    const list = vendors(browser)
    validateVendorsOrExit(list)

    const {extensionDev} = await import('extension-develop')
    for (const vendor of list) {
      await extensionDev(pathOrRemoteUrl, {
        ...devOptions,
        profile: devOptions.profile,
        browser: vendor as DevOptions['browser'],
        chromiumBinary: devOptions.chromiumBinary,
        geckoBinary: devOptions.geckoBinary,
        polyfill: devOptions.polyfill?.toString() === 'false' ? false : true,
        open: devOptions.open,
        startingUrl: devOptions.startingUrl,
        source: devOptions.source,
        watchSource: devOptions.watchSource
      })
    }
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
    const list = vendors(browser)
    validateVendorsOrExit(list)

    const {extensionStart} = await import('extension-develop')
    for (const vendor of list) {
      await extensionStart(pathOrRemoteUrl, {
        mode: 'production',
        profile: startOptions.profile,
        browser: vendor as StartOptions['browser'],
        chromiumBinary: startOptions.chromiumBinary,
        geckoBinary: startOptions.geckoBinary,
        startingUrl: startOptions.startingUrl
      })
    }
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
    const list = vendors(browser)
    validateVendorsOrExit(list)

    const {extensionPreview} = await import('extension-develop')
    for (const vendor of list) {
      await extensionPreview(pathOrRemoteUrl, {
        mode: 'production',
        profile: previewOptions.profile,
        browser: vendor as PreviewOptions['browser'],
        chromiumBinary: previewOptions.chromiumBinary,
        geckoBinary: previewOptions.geckoBinary,
        startingUrl: previewOptions.startingUrl
      })
    }
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
    const list = vendors(browser)
    validateVendorsOrExit(list)

    const {extensionBuild} = await import('extension-develop')
    for (const vendor of list) {
      await extensionBuild(pathOrRemoteUrl, {
        browser: vendor as BuildOptions['browser'],
        polyfill: buildOptions.polyfill,
        zip: buildOptions.zip,
        zipSource: buildOptions.zipSource,
        zipFilename: buildOptions.zipFilename,
        silent: buildOptions.silent
      })
    }
  })

// ██████╗██╗     ███████╗ █████╗ ███╗   ██╗██╗   ██╗██████╗
// ██╔════╝██║     ██╔════╝██╔══██╗████╗  ██║██║   ██║██╔══██╗
// ██║     ██║     █████╗  ███████║██╔██╗ ██║██║   ██║██████╔╝
// ██║     ██║     ██╔══╝  ██╔══██║██║╚██╗██║██║   ██║██╔═══╝
// ╚██████╗███████╗███████╗██║  ██║██║ ╚████║╚██████╔╝██║
//  ╚═════╝╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝

extensionJs
  .command('cleanup')
  .description('Clean up orphaned instances and free unused ports')
  .action(async function () {
    const {cleanupCommand} = await import('extension-develop')
    await cleanupCommand()
  })

// Print AI-focused help and exit when --ai-help is provided
extensionJs.on('option:ai-help', function () {
  // eslint-disable-next-line no-console
  console.log(messages.programAIHelp())
  process.exit(0)
})

extensionJs.parse()
