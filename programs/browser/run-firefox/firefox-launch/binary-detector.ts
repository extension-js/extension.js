// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {promisify} from 'util'
import {execFile as execFileCb} from 'child_process'

const execFile = promisify(execFileCb)

export class FirefoxBinaryDetector {
  static generateFirefoxArgs(
    binaryPath: string,
    profilePath: string,
    debugPort: number,
    additionalArgs: string[] = []
  ): {binary: string; args: string[]} {
    const args: string[] = [
      '--no-remote',
      '--new-instance',
      ...(process.platform === 'win32' ? ['-wait-for-browser'] : []),
      '-profile',
      profilePath,
      ...(debugPort > 0 ? ['-start-debugger-server', String(debugPort)] : []),
      '--foreground',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      ...additionalArgs
    ]

    return {binary: binaryPath, args}
  }

  static async validateFirefoxBinary(
    binaryPath: string
  ): Promise<{version: string; path: string}> {
    try {
      const {stdout} = await execFile(binaryPath, ['--version'])
      const version = stdout.trim()

      return {version, path: binaryPath}
    } catch (error) {
      throw new Error(`Failed to validate Firefox binary: ${error}`)
    }
  }
}
