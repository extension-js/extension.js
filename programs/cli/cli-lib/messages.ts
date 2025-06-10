//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝

import colors from 'pintor'

export function updateFailed(err: any) {
  return '🧩\n' + colors.red(`Failed to check for updates: ${err.message}`)
}

export function checkUpdates(
  packageJson: Record<string, any>,
  update: {latest: string}
) {
  return (
    `🧩` +
    `\n${colors.yellow('Notice:')} A new version of ${colors.green(
      'Extension.js'
    )} is available!` +
    `\nYou are currently using version ${colors.yellow(packageJson.version)}.` +
    `\nThe latest stable version is ${colors.yellow(update.latest)}.` +
    `\nPlease update to the latest version to enjoy new features and improvements.\n`
  )
}

export function unsupportedNodeVersion() {
  return (
    `🧩\n` +
    colors.red(
      `You are using an unsupported Node version (${process.version}).\n`
    ) +
    `Please update to a version higher than ${colors.green('18')}.\n`
  )
}

export function noURLWithoutStart(argument: string) {
  return (
    `🧩\n` +
    `The default ${colors.yellow('create')} command does not accept URLs.` +
    `\nAre you forgetting a ${colors.yellow('start')} command? Maybe:\n\n` +
    `${colors.blue(`npx extension ${colors.yellow('start')} ${argument}`)}`
  )
}

export function notImplemented(argument: string) {
  return `🧩\n` + colors.red(`${argument} command not implemented yet.`)
}

export function programHelp() {
  return `🧩
${colors.underline('Help center for the Extension.js program')}

${colors.yellow('Usage:')} extension [command] [options]

${colors.yellow('Note:')} If you are looking for a specific list of options,
all high-level commands offer their own \`--help\` file with
information about usage and a list of command flags available.

For example:

${colors.green('extension create --help')}
outputs information about the "create" command.

Options available:

${colors.green('extension create <extension-name>')}
Creates a new extension from a template. The "create" command
is optional and can be omitted.

${colors.green('extension dev <extension-path>')}
Starts a new browser instance in development mode, with the target
extension loaded and auto-reloaded based on file changes.

${colors.green('extension start <extension-path>')}
Starts a new browser instance in production mode, with the target
extension compiled based on the browser choice.

${colors.green('extension build <extension-path>')}
Builds the target extension with browser defaults, ready for packaging.

${colors.green('extension --help')}
This command ;) Outputs a help file with key command options.

${colors.yellow('Feels something is wrong? Help by reporting a bug:')}
${colors.underline('https://github.com/cezaraugusto/extension/issues/new')}
`
}
