const { log } = require('log-md')
const { program } = require('commander')

const packageJson = require('./package.json')

function help () {
  log(`
    # Help center for the \`extension-create\` app

    All high-level commands for \`extension-create\` are below.
    Each of these commands offer their own \`--help\` files providing
    information about usage and command flags available. For example:
    \`extension-create create --help\` outputs information
    about the \`create\` command.

    Usage: \`extension-create [command] [options]\`

      \`extension-create create\`
      Creates a new extension from template. The "create" command
      is optional and can be ommitted.

    Feels something is wrong? Help by reporting a bug:
    https://github.com/cezaraugusto/extension-create/issues/new
  `)
}

module.exports = function () {
  program
    .version(packageJson.version)
    .on('--help', () => help())
    .parse(process.argv)
}
