//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝

import chalk from 'chalk'

export function updateFailed(err: any) {
  return '🧩\n' + chalk.red(`Failed to check for updates: ${err.message}`)
}

export function checkUpdates(
  packageJson: Record<string, any>,
  update: {latest: string}
) {
  return (
    `🧩` +
    `\n${chalk.yellow('Notice:')} A new version of ${chalk.green(
      'Extension.js'
    )} is available!` +
    `\nYou are currently using version ${chalk.yellow(packageJson.version)}.` +
    `\nThe latest stable version is ${chalk.yellow(update.latest)}.` +
    `\nPlease update to the latest version to enjoy new features and improvements.\n`
  )
}

export function unsupportedNodeVersion() {
  return (
    `🧩\n` +
    chalk.red(
      `You are using an unsupported Node version (${process.version}).\n`
    ) +
    `Please update to a version higher than ${chalk.green('18')}.\n`
  )
}

export function noURLWithoutStart(argument: string) {
  return (
    `🧩\n` +
    `The default ${chalk.yellow('create')} command does not accept URLs.` +
    `\nAre you forgetting a ${chalk.yellow('start')} command? Maybe:\n\n` +
    `${chalk.blue(`npx extension ${chalk.yellow('start')} ${argument}`)}`
  )
}

export function notImplemented(argument: string) {
  return `🧩\n` + chalk.red(`${argument} command not implemented yet.`)
}

export function programHelp() {
  return `🧩
${chalk.underline('Help center for the Extension.js program')}

${chalk.yellow('Usage:')} extension [command] [options]

${chalk.yellow('Note:')} If you are looking for a specific list of options,
all high-level commands offer their own \`--help\` file with
information about usage and a list of command flags available.

For example:

${chalk.green('extension create --help')}
outputs information about the "create" command.

Options available:

${chalk.green('extension create <extension-name>')}
Creates a new extension from a template. The "create" command
is optional and can be omitted.

${chalk.green('extension dev <extension-path>')}
Starts a new browser instance in development mode, with the target
extension loaded and auto-reloaded based on file changes.

${chalk.green('extension start <extension-path>')}
Starts a new browser instance in production mode, with the target
extension compiled based on the browser choice.

${chalk.green('extension build <extension-path>')}
Builds the target extension with browser defaults, ready for packaging.

${chalk.green('extension --help')}
This command ;) Outputs a help file with key command options.

${chalk.yellow('Feels something is wrong? Help by reporting a bug:')}
${chalk.underline('https://github.com/cezaraugusto/extension/issues/new')}
`
}
