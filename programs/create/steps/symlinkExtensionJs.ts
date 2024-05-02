//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
import {spawn} from 'cross-spawn'
import {getInstallCommand} from '../helpers/getInstallInfo'

export default async function createSymlink(projectPath: string) {
  const extensionJsCliDir = path.join(__dirname, '../../cli')
  const command = getInstallCommand()
  const args = ['link']

  await new Promise<void>((resolve, reject) => {
    // Link Extension to the project
    const linkExtensionJs = spawn(command, args, {
      cwd: extensionJsCliDir
    })

    linkExtensionJs.on('close', (code) => {
      const linkProcess = spawn(command, [...args, 'extension'], {
        stdio: 'inherit',
        cwd: projectPath
      })

      linkProcess.on('close', (code) => {
        if (code === 0) {
          console.log('Symlink created successfully.')
          resolve()
        } else {
          reject(
            new Error(`Failed to create symlink: ${command} ${args.join(' ')}`)
          )
        }
      })
    })
  })

  console.log('Symlink creation completed.')
}
