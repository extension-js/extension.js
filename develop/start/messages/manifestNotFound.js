const { log } = require('log-md')

module.exports = function () {
  log(`
    # Error! Can't find the project's manifest file.

    By default both root and \`public/\` folder are scanned, but none was found.

    If you store your manifest file somewhere else, you need to tell
    \`create-browser-extension\` where to look using the \`--manifest\` flag.

    \`create-browser-extension start --manifest=\`<path-to-manifest>
  `)
}
