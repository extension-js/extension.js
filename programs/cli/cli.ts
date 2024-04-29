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
import type {BrowsersSupported} from './types'

// Modules
import createExtension from '@extension-create/create'
import {
  extensionDev,
  extensionStart,
  extensionBuild
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

const extensionCreate = program

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

// If users are using extension-create, prevents from writing
// extension create <...args> and do extension <...args> instead.
// for the extension namespace, users will npx extension create <...args>
const isExtensionCreateNamespace = packageJson.name !== 'extension'

if (process.env.EXTENSION_ENV === 'development') {
  console.log(`Running extension via ${packageJson.name}...`)
}

extensionCreate
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
  browser === 'all' ? 'chrome,edge'.split(',') : browser.split(',')

extensionCreate
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
    }: CreateOptions & DevOptions & StartOptions & BuildOptions
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

extensionCreate
  .command('dev')
  .arguments('[project-path|remote-url]')
  .usage('dev [project-path|remote-url] [options]')
  .description('Starts the development server (development mode)')
  .option(
    '-u, --user-data-dir <path-to-file | boolean>',
    'what path to use for the browser profile. A boolean value of false sets the profile to the default user profile. Defaults to a fresh profile'
  )
  .option(
    '-b, --browser <chrome | edge>',
    'specify a browser to run your extension in development mode'
  )
  .option(
    '--polyfill <boolean>',
    'whether or not to apply the cross-browser polyfill. Defaults to `true`'
  )
  .option(
    '-p, --port <number>',
    'what port should Extension run. Defaults to `3000`'
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

extensionCreate
  .command('start')
  .arguments('[project-path|remote-url]')
  .usage('start [project-path|remote-url] [options]')
  .description('Starts the development server (production mode)')
  .option(
    '-u, --user-data-dir <path-to-file | boolean>',
    'what path to use for the browser profile. A boolean value of false sets the profile to the default user profile. Defaults to a fresh profile'
  )
  .option(
    '-b, --browser <chrome | edge>',
    'specify a browser to run your extension in development mode'
  )
  .option(
    '--polyfill <boolean>',
    'whether or not to apply the cross-browser polyfill. Defaults to `true`'
  )
  .option(
    '-p, --port <number>',
    'what port should Extension run. Defaults to `3000`'
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

// ██████╗ ██╗   ██╗██╗██╗     ██████╗
// ██╔══██╗██║   ██║██║██║     ██╔══██╗
// ██████╔╝██║   ██║██║██║     ██║  ██║
// ██╔══██╗██║   ██║██║██║     ██║  ██║
// ██████╔╝╚██████╔╝██║███████╗██████╔╝
// ╚═════╝  ╚═════╝ ╚═╝╚══════╝╚═════╝

extensionCreate
  .command('build')
  .arguments('[project-name]')
  .usage('build [path-to-remote-extension] [options]')
  .description('Builds the extension for production')
  .option(
    '-b, --browser <chrome | edge>',
    'specify a browser to run your extension in development mode'
  )
  .option(
    '--polyfill <boolean>',
    'whether or not to apply the cross-browser polyfill. Defaults to `false`'
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

extensionCreate.parse()
