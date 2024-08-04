//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝

import {yellow, green} from '@colors/colors/safe'

export function updateFailed(err: any) {
  return `Failed to check for updates: ${err.message}`
}

export function checkUpdates(
  packageJson: Record<string, any>,
  update: {latest: string}
) {
  return (
    `\n🧩` +
    `\n${yellow('Notice:')} A new version of ${green('Extension.js')} is available!` +
    `\nYou are currently using version ${packageJson.version}.` +
    `\nThe latest stable version is ${update.latest}.` +
    `\nPlease update to the latest version to enjoy new features and improvements.\n`
  )
}

export function unsupportedNodeVersion() {
  return `
    You are using an unsupported Node version (${process.version}).

    Please update to a version higher than 18.
  `
}

export function noURLWithoutStart(argument: string) {
  return `
    The default \`create\` command does not accept URLs.
    Are you forgetting a \`start\` command? Maybe:

    npx extension \`start\` ${argument}
  `
}

export function notImplemented(argument: string) {
  return `${argument} command not implemented yet.`
}

export function programHelp() {
  return `
# Help center for the 🧩 Extension.js program

## Usage: \`extension [command] [options]\`

**Note:** If you are looking for a specific list of options,
all high-level commands offer their own \`--help\` file with
information about usage and a list of command flags available.

For example:

\`extension create --help\`
outputs information about the \`create\` command.

## Options available

\`extension create <extension-name>\`
Creates a new extension from template. The "create" command
is optional and can be ommitted.

\`extension dev <extension-path>\`
Starts a new browser instance in development mode, with the target
extension loaded and auto-reloaded based on file changes.

\`extension start <extension-path>\`
Starts a new browser instance in production mode, with the target
extension compiled based on the browser choice.

\`extension build <extension-path>\`
Builds the target extension with browser defaults, ready for packaging.

\`extension --help\`
This command ;) Outputs a help file with key command options.

Feels something is wrong? Help by reporting a bug:
https://github.com/cezaraugusto/extension/issues/new
`
}
