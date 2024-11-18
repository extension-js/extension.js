#!/usr/bin/env node

// ███████╗██╗  ██╗████████╗███████╗███╗   ██╗███████╗██╗ ██████╗ ███╗   ██╗        ██╗███████╗
// ██╔════╝╚██╗██╔╝╚══██╔══╝██╔════╝████╗  ██║██╔════╝██║██╔═══██╗████╗  ██║        ██║██╔════╝
// █████╗   ╚███╔╝    ██║   █████╗  ██╔██╗ ██║███████╗██║██║   ██║██╔██╗ ██║        ██║███████╗
// ██╔══╝   ██╔██╗    ██║   ██╔══╝  ██║╚██╗██║╚════██║██║██║   ██║██║╚██╗██║   ██   ██║╚════██║
// ███████╗██╔╝ ██╗   ██║   ███████╗██║ ╚████║███████║██║╚██████╔╝██║ ╚████║██╗╚█████╔╝███████║
// ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═══╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝ ╚════╝ ╚══════╝

import {program} from 'commander'
import {extensionCreate, type CreateOptions} from 'extension-create'
import {
  extensionDev,
  type DevOptions,
  extensionStart,
  type StartOptions,
  extensionBuild,
  type BuildOptions,
  extensionPreview,
  type PreviewOptions,
  type FileConfig,
  type Manifest
} from 'extension-develop'
import * as messages from './cli-lib/messages'
import type {BrowsersSupported} from './types'
import checkUpdates from './check-updates'
import packageJson from './package.json'

export {type FileConfig, type Manifest}

// Before all, check for updates.
checkUpdates(packageJson)

const extensionJs = program

//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝

const vendors = (browser: BrowsersSupported) =>
  browser === 'all' ? 'chrome,edge,firefox'.split(',') : browser.split(',')

extensionJs
  .name(packageJson.name)
  .description(packageJson.description)
  .version(packageJson.version)
  .addHelpText('after', messages.programHelp())

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
    '--install',
    'whether or not to install the dependencies after creating the project'
  )
  .action(async function (
    pathOrRemoteUrl: string,
    {template, install}: CreateOptions
  ) {
    await extensionCreate(pathOrRemoteUrl, {
      template,
      install
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
  .action(async function (
    pathOrRemoteUrl: string,
    {browser = 'chrome', ...devOptions}: DevOptions
  ) {
    for (const vendor of vendors(browser)) {
      await extensionDev(pathOrRemoteUrl, {
        ...devOptions,
        profile: devOptions.profile,
        browser: vendor as DevOptions['browser'],
        chromiumBinary: devOptions.chromiumBinary,
        geckoBinary: devOptions.geckoBinary,
        // @ts-expect-error open is a boolean
        polyfill: devOptions.polyfill === 'false' ? false : true,
        open: devOptions.open,
        startingUrl: devOptions.startingUrl
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
  .action(async function (
    pathOrRemoteUrl: string,
    {browser = 'chrome', ...startOptions}: StartOptions
  ) {
    for (const vendor of vendors(browser)) {
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
  .action(async function (
    pathOrRemoteUrl: string,
    {browser = 'chrome', ...previewOptions}: PreviewOptions
  ) {
    for (const vendor of vendors(browser)) {
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
    for (const vendor of vendors(browser)) {
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

extensionJs.parse()
