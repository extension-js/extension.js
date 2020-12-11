//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

const path = require('path')

const { log } = require('log-md')

module.exports = async function (workingDir, projectName) {
  const projectPath = path.join(workingDir, projectName)
  const relativePath = path.relative(workingDir, projectPath)

  await Promise.resolve(
    log(`
      # Success! Extension ${projectName} created at ${relativePath}.

      Now \`cd ${relativePath}\` and *npm start* to open a new browser instance
      with your extension installed, loaded, and ready for development.

      You are done. Time to hack on your extension!
    `)
  )
}
