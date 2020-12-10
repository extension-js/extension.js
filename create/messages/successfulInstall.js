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

  await Promise.resolve(
    log(`
       # Success!

       Created extension \`${projectName}\` at \`${projectPath}\`.

       Go to \`${projectPath}\` and run \`npm start\` to start developing
       your extension without any further step.

      Happy coding!
    `)
  )
}
