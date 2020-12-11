// ███████╗████████╗ █████╗ ██████╗ ████████╗
// ██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚══██╔══╝
// ███████╗   ██║   ███████║██████╔╝   ██║
// ╚════██║   ██║   ██╔══██║██╔══██╗   ██║
// ███████║   ██║   ██║  ██║██║  ██║   ██║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝

const { log } = require('log-md')

module.exports = function () {
  log(`
    # Error! Can't find the project's manifest file.

    By default both root and \`public/\` folder are scanned, but none was found.

    If you store your manifest file somewhere else, you need to tell
    \`extension-create\` where to look using the \`--manifest\` flag.

    \`extension-create start --manifest=\`<path-to-manifest>
  `)
}
