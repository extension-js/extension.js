// ███████╗████████╗ █████╗ ██████╗ ████████╗
// ██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚══██╔══╝
// ███████╗   ██║   ███████║██████╔╝   ██║
// ╚════██║   ██║   ██╔══██║██╔══██╗   ██║
// ███████║   ██║   ██║  ██║██║  ██║   ██║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝

const {log} = require('log-md')

module.exports = function manifestNotFound() {
  log(`
    # Error! Can't find the project's manifest file.

    By default, extension-create scans the root folder and the paths to
    \`src/\`, and \`public/\` looking for a manifest file, but none was found.

    The argument after \`start\` needs to point to a folder where the
    manifest is available within one of the paths above.

    \`extension-create start\` <path-to-extension-folder>
  `)
}
