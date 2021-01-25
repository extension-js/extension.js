const {log} = require('log-md')

function help () {
  log(`
    # Help center for the extension-create program

    ## Usage: \`extension-create [command] [options]\`

    **Note:** If you are looking for a specific list of options,
    all high-level commands offer their own \`--help\` file with
    information about usage and a list of command flags available.

    For example:

    \`extension-create create --help\`
    outputs information about the \`create\` command.

    ## Options available

    \`extension-create create <extension-name>\`
    Creates a new extension from template. The "create" command
    is optional and can be ommitted.

    \`extension-create start <extension-path>\`
    Starts a new browser instance with the target extension loaded
    and set up as a modern web app including esnext and module support.

    \`extension-create --help\`
    This command ;) Outputs a help file with key command options.

    Feels something is wrong? Help by reporting a bug:
    https://github.com/cezaraugusto/extension-create/issues/new
  `)
}

function unsupportedNodeVersion () {
  log(`
    You are using an unsupported Node version (${process.version}).

    Please update to a version higher than 10.
  `)
}

function noURLWithoutStart (argument) {
  log(`
    The default \`create\` command does not accept URLs.
    Are you forgetting a \`start\` command? Maybe:

    npx extension-create \`start\` ${argument}
  `)
}

module.exports = {
  help,
  unsupportedNodeVersion,
  noURLWithoutStart
}
