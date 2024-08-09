//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝

import {
  brightYellow,
  brightBlue,
  brightGreen,
  red,
  underline
} from '@colors/colors/safe'

export function updateFailed(err: any) {
  return '🧩\n' + red(`Failed to check for updates: ${err.message}`)
}

export function checkUpdates(
  packageJson: Record<string, any>,
  update: {latest: string}
) {
  return (
    `🧩` +
    `\n${brightYellow('Notice:')} A new version of ${brightGreen(
      'Extension.js'
    )} is available!` +
    `\nYou are currently using version ${brightYellow(packageJson.version)}.` +
    `\nThe latest stable version is ${brightYellow(update.latest)}.` +
    `\nPlease update to the latest version to enjoy new features and improvements.\n`
  )
}

export function unsupportedNodeVersion() {
  return (
    `🧩\n` +
    red(`You are using an unsupported Node version (${process.version}).\n`) +
    `Please update to a version higher than ${brightGreen('18')}.\n`
  )
}

export function noURLWithoutStart(argument: string) {
  return (
    `🧩\n` +
    `The default ${brightYellow('create')} command does not accept URLs.` +
    `\nAre you forgetting a ${brightYellow('start')} command? Maybe:\n\n` +
    `${brightBlue(`npx extension ${brightYellow('start')} ${argument}`)}`
  )
}

export function notImplemented(argument: string) {
  return `🧩\n` + red(`${argument} command not implemented yet.`)
}

export function programHelp() {
  return `🧩
${brightGreen('Help center for the Extension.js program')}

${brightYellow('Usage:')} extension [command] [options]

${brightBlue('Note:')} If you are looking for a specific list of options,
all high-level commands offer their own \`--help\` file with
information about usage and a list of command flags available.

For example:

${brightBlue('extension create --help')}
outputs information about the \`create\` command.

Options available:

${brightBlue('extension create <extension-name>')}
Creates a new extension from a template. The "create" command
is optional and can be omitted.

${brightBlue('extension dev <extension-path>')}
Starts a new browser instance in development mode, with the target
extension loaded and auto-reloaded based on file changes.

${brightBlue('extension start <extension-path>')}
Starts a new browser instance in production mode, with the target
extension compiled based on the browser choice.

${brightBlue('extension build <extension-path>')}
Builds the target extension with browser defaults, ready for packaging.

${brightBlue('extension --help')}
This command ;) Outputs a help file with key command options.

${brightYellow('Feels something is wrong? Help by reporting a bug:')}
${underline('https://github.com/cezaraugusto/extension/issues/new')}
`
}
