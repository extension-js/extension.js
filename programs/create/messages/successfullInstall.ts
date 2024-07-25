//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
// @ts-ignore
import prefersYarn from 'prefers-yarn'
import {bold, blue, green, underline} from '@colors/colors/safe'

export default function successfullInstall(
  projectPath: string,
  projectName: string
) {
  const relativePath = path.relative(process.cwd(), projectPath)

  console.log(`🧩 - ${green('Success!')} Extension ${projectName} created.`)

  const packageManager = prefersYarn() ? 'yarn' : 'npm run'
  console.log(`
Now ${blue(`cd ${underline(relativePath)}`)} and ${blue(
    `${packageManager} dev`
  )} to open a new browser instance
with your extension installed, loaded, and enabled for development.

You are ready. Time to hack on your extension!
  `)
}
