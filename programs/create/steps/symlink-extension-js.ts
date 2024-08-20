//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
import {spawn} from 'cross-spawn'
import * as messages from '../lib/messages'
import * as utils from '../lib/utils'

export async function createSymlink(projectPath: string) {
  const extensionJsCliDir = path.join(__dirname, '../../cli')
  const command = await utils.getInstallCommand()
  const args = ['link']

  await new Promise<void>((resolve, reject) => {
    // Link Extension to the project
    const linkExtensionJs = spawn(command, args, {
      cwd: extensionJsCliDir
    })

    linkExtensionJs.on('close', () => {
      const linkProcess = spawn(command, [...args, 'extension'], {
        stdio: 'inherit',
        cwd: projectPath
      })

      linkProcess.on('close', (code) => {
        if (code === 0) {
          console.log(messages.symlinkCreated())
          resolve()
        } else {
          reject(new Error(messages.symlinkError(command, args)))
        }
      })
    })
  })

  console.log('Symlink creation completed.')
}
