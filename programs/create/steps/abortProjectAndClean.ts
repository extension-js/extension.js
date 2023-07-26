//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
import fs from 'fs/promises'

export default async function abortProjectAndClean(
  error: any,
  workingDir: string,
  projectName: string
) {
  const projectPath = path.resolve(workingDir, projectName)

  console.log('😑👎 Aborting installation.')

  if (error.command) {
    console.log(`😕❓ ${error.command} has failed.`)
  } else {
    console.log('🚨 Unexpected creation error. This is a bug.')
    console.log(`Please report: "${JSON.stringify(error)}"`)
    console.log('https://github.com/cezaraugusto/extension-create/issues/')
  }

  console.log('🧹 - Removing files generated from project in:')
  console.log(`\`${projectPath}\``)
  await fs.mkdir(projectPath, {recursive: true})
  await fs.rm(projectPath, {recursive: true, force: true})

  process.exit(1)
}
