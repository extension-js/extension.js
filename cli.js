const { log } = require('log-md')
const { program } = require('commander')

const packageJson = require('./package.json')

function help () {
  log(`
    # Help center for the \`create-browser-extension\` app

    All high-level commands for \`create-browser-extension\` are below.
    Each of these commands offer their own \`--help\` files providing
    information about usage and command flags available. For example:
    \`create-browser-extension create --help\` outputs information
    about the \`create\` command.

    Usage: \`create-browser-extension [command] [options]\`

      \`create-browser-extension create\`
      Creates a new extension from template. The "create" command
      is optional and can be ommitted.

    Feels something is wrong? Help by reporting a bug:
    https://github.com/cezaraugusto/create-browser-extension/issues/new
  `)
}

module.exports = function () {
  program
    .version(packageJson.version)
    .on('--help', () => help())
    .parse(process.argv)
}
