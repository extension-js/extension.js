//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'

export default function successfullInstall(
  workingDir: string,
  projectName: string
) {
  const projectPath = path.join(workingDir, projectName)
  const relativePath = path.relative(workingDir, projectPath)

  console.log(`🧩 - Success! Extension \`${projectName}\` created.`)

  console.log(`
Now \`cd\` *${relativePath}* and *npm dev* to open a new browser instance
with your extension installed, loaded, and ready for development.

You are done. Time to hack on your extension!
  `)
}
