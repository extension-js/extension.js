// ███████╗████████╗ █████╗ ██████╗ ████████╗
// ██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚══██╔══╝
// ███████╗   ██║   ███████║██████╔╝   ██║
// ╚════██║   ██║   ██╔══██║██╔══██╗   ██║
// ███████║   ██║   ██║  ██║██║  ██║   ██║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝

const { log } = require('log-md')

module.exports = function () {
  log(`
    ## The \`--manifest\` _<path-to-manifest>_ flag

    You can specify a custom path to your manifest file. By default
    \`extension-create\` will look for your project's root
    path and **public/** directory, failing if no manifest is found.

    Feels something is wrong? Help by reporting a bug:
    https://github.com/cezaraugusto/extension-create/issues/new
  `)
}
