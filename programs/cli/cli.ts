#!/usr/bin/env node

//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝

import semver from 'semver'
import {program} from 'commander'

// Types
import type {CreateOptions} from '@extension-create/create'
import type {DevOptions} from '@extension-create/develop/extensionDev'
import type {StartOptions} from '@extension-create/develop/extensionStart'
import type {BuildOptions} from '@extension-create/develop/extensionBuild'
import type {PreviewOptions} from '@extension-create/develop/extensionPreview'
import type {BrowsersSupported} from './types'

// Modules
import createExtension from '@extension-create/create'
import {
  extensionDev,
  extensionStart,
  extensionBuild,
  extensionPreview
} from '@extension-create/develop'

import checkUpdates from './check-updates'
import messages from './messages'
import packageJson from './package.json'

// Before all, check for updates.
checkUpdates(packageJson)

if (semver.lte(process.version, '18.0.0')) {
  messages.unsupportedNodeVersion()
  process.exit(1)
}

const extensionJs = program

// ███████╗██╗  ██╗████████╗███████╗███╗   ██╗███████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝╚██╗██╔╝╚══██╔══╝██╔════╝████╗  ██║██╔════╝██║██╔═══██╗████╗  ██║
// █████╗   ╚███╔╝    ██║   █████╗  ██╔██╗ ██║███████╗██║██║   ██║██╔██╗ ██║
// ██╔══╝   ██╔██╗    ██║   ██╔══╝  ██║╚██╗██║╚════██║██║██║   ██║██║╚██╗██║
// ███████╗██╔╝ ██╗   ██║   ███████╗██║ ╚████║███████║██║╚██████╔╝██║ ╚████║
// ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═══╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝
//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

if (process.env.EXTENSION_ENV === 'development') {
  console.log(`Running extension via ${packageJson.name}...`)
}

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

const vendors = (browser: BrowsersSupported) =>
  browser === 'all' ? 'chrome,edge,firefox'.split(',') : browser.split(',')

extensionJs
  .command('create')
  .arguments('<project-name|project-path>')
  .usage('create <project-name|project-path> [options]')
  .description('Creates a new extension.')
  .option(
    '-t, --template <template-name>',
    'specify a template for the created project'
  )
  .action(async function (
    pathOrRemoteUrl: string,
    {
      browser = 'chrome',
      template,
      ...otherCommandOptions
    }: CreateOptions & DevOptions & StartOptions & BuildOptions & PreviewOptions
  ) {
    switch (pathOrRemoteUrl) {
      case 'dev':
        for (const vendor of vendors(browser)) {
          await extensionDev(pathOrRemoteUrl, {
            mode: 'development',
            browser: vendor as any,
            ...otherCommandOptions
          })
        }
        break
      case 'start':
        for (const vendor of vendors(browser)) {
          await extensionStart(pathOrRemoteUrl, {
            mode: 'production',
            browser: vendor as any,
            ...otherCommandOptions
          })
        }
        break
      case 'build':
        for (const vendor of vendors(browser)) {
          await extensionBuild(pathOrRemoteUrl, {
            browser: vendor as any,
            ...otherCommandOptions
          })
        }
        break
      default:
        await createExtension(pathOrRemoteUrl, {template})
        break
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
    '-u, --user-data-dir <path-to-file | boolean>',
    'what path to use for the browser profile. A boolean value of false sets the profile to the default user profile. Defaults to a fresh profile'
  )
  .option(
    '-b, --browser <chrome | edge | firefox>',
    'specify a browser to run your extension in development mode'
  )
  .option(
    '--polyfill [boolean]',
    'whether or not to apply the cross-browser polyfill. Defaults to `true`'
  )
  .option(
    '-p, --port <number>',
    'what port should Extension.js run. Defaults to `3000`'
  )
  .action(async function (
    pathOrRemoteUrl: string,
    {browser = 'chrome', ...devOptions}: DevOptions
  ) {
    for (const vendor of vendors(browser)) {
      await extensionDev(pathOrRemoteUrl, {
        mode: 'development',
        browser: vendor as any,
        ...devOptions
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
    '-u, --user-data-dir <path-to-file | boolean>',
    'what path to use for the browser profile. A boolean value of false sets the profile to the default user profile. Defaults to a fresh profile'
  )
  .option(
    '-b, --browser <chrome | edge | firefox>',
    'specify a browser to run your extension in development mode'
  )
  .option(
    '--polyfill [boolean]',
    'whether or not to apply the cross-browser polyfill. Defaults to `true`'
  )
  .option(
    '-p, --port <number>',
    'what port should Extension.js run. Defaults to `3000`'
  )
  .action(async function (
    pathOrRemoteUrl: string,
    {browser = 'chrome', ...startOptions}: StartOptions
  ) {
    for (const vendor of vendors(browser)) {
      await extensionStart(pathOrRemoteUrl, {
        mode: 'production',
        browser: vendor as any,
        ...startOptions
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
  .description('Builds the extension for production')
  .option(
    '-b, --browser <chrome | edge | firefox>',
    'specify a browser to preview your extension in production mode'
  )
  .action(async function (
    pathOrRemoteUrl: string,
    {browser = 'chrome', ...previewOptions}: BuildOptions
  ) {
    for (const vendor of vendors(browser)) {
      await extensionPreview(pathOrRemoteUrl, {
        browser: vendor as any,
        ...previewOptions
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
    '-b, --browser <chrome | edge | firefox>',
    'specify a browser to run your extension in development mode'
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
  .action(async function (
    pathOrRemoteUrl: string,
    {browser = 'chrome', ...buildOptions}: BuildOptions
  ) {
    for (const vendor of vendors(browser)) {
      await extensionBuild(pathOrRemoteUrl, {
        browser: vendor as any,
        ...buildOptions
      })
    }
  })

extensionJs.parse()
