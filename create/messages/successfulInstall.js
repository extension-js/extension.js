const path = require('path')

const { log } = require('log-md')

module.exports = function (workingDir, projectName) {
  log(`
     # Success! Your browser extension is ready for development.

     - Your extension \`${projectName}\`
     - Path to your extension: \`${path.join(workingDir, projectName)}\`
  `)
}
