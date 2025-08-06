import * as fs from 'fs'
import * as path from 'path'
import {promisify} from 'util'
import * as messages from '../../../webpack/lib/messages'

const exec = promisify(require('child_process').exec)

// Firefox Binary Detector
// Supports multiple Firefox distribution methods including Flatpak
export class FirefoxBinaryDetector {
  static async detectFirefoxBinary(customBinary?: string): Promise<string> {
    // If custom binary is specified, use it
    if (customBinary) {
      if (fs.existsSync(customBinary)) {
        return customBinary
      }
      throw new Error(
        `Firefox binary not found at specified path: ${customBinary}`
      )
    }

    // Check for Flatpak Firefox
    const flatpakPath = await this.detectFlatpakFirefox()
    if (flatpakPath) {
      return flatpakPath
    }

    // Check for Snap Firefox (Ubuntu)
    const snapPath = await this.detectSnapFirefox()
    if (snapPath) {
      return snapPath
    }

    // Check for traditional Firefox installations
    const traditionalPath = this.detectTraditionalFirefox()
    if (traditionalPath) {
      return traditionalPath
    }

    // Check for custom Firefox builds
    const customPath = this.detectCustomFirefox()
    if (customPath) {
      return customPath
    }

    throw new Error(
      'Firefox not found. Please install Firefox or specify --geckoBinary path'
    )
  }

  private static async detectFlatpakFirefox(): Promise<string | null> {
    try {
      // Check if flatpak is available
      await exec('which flatpak')

      // Check if Firefox is installed via flatpak
      const {stdout} = await exec(
        'flatpak list --app --columns=application | grep -i firefox'
      )

      if (stdout.trim()) {
        console.log(messages.firefoxDetectedFlatpak())
        return 'flatpak'
      }
    } catch (error) {
      // Flatpak not available or Firefox not installed via flatpak
    }

    return null
  }

  private static async detectSnapFirefox(): Promise<string | null> {
    try {
      // Check if snap is available
      await exec('which snap')

      // Check if Firefox is installed via snap
      const {stdout} = await exec('snap list | grep -i firefox')

      if (stdout.trim()) {
        console.log(messages.firefoxDetectedSnap())
        return '/snap/bin/firefox'
      }
    } catch (error) {
      // Snap not available or Firefox not installed via snap
    }

    return null
  }

  private static detectTraditionalFirefox(): string | null {
    const possiblePaths = [
      // Linux
      '/usr/bin/firefox',
      '/usr/local/bin/firefox',
      '/opt/firefox/firefox',

      // macOS
      '/Applications/Firefox.app/Contents/MacOS/firefox',
      '/usr/local/bin/firefox',

      // Windows (if running on Windows)
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe'
    ]

    for (const firefoxPath of possiblePaths) {
      if (fs.existsSync(firefoxPath)) {
        console.log(messages.firefoxDetectedTraditional(firefoxPath))
        return firefoxPath
      }
    }

    return null
  }

  private static detectCustomFirefox(): string | null {
    const possiblePaths = [
      // Common custom build locations
      path.join(process.env.HOME || '', 'firefox', 'firefox'),
      path.join(process.env.HOME || '', 'Downloads', 'firefox', 'firefox'),
      path.join(process.env.HOME || '', 'bin', 'firefox'),
      '/opt/firefox-dev/firefox',
      '/usr/local/firefox/firefox'
    ]

    for (const firefoxPath of possiblePaths) {
      if (fs.existsSync(firefoxPath)) {
        console.log(messages.firefoxDetectedCustom(firefoxPath))
        return firefoxPath
      }
    }

    return null
  }

  static generateFirefoxArgs(
    binaryPath: string,
    profilePath: string,
    debugPort: number,
    additionalArgs: string[] = []
  ): {binary: string; args: string[]} {
    const args: string[] = [
      '--no-remote',
      '--new-instance',
      `-profile=${profilePath}`,
      `-start-debugger-server=${debugPort}`,
      '--foreground'
    ]

    // Add additional arguments
    args.push(...additionalArgs)

    if (binaryPath === 'flatpak') {
      // Flatpak-specific arguments
      const flatpakArgs = [
        'run',
        `--filesystem=${profilePath}`,
        '--share=network',
        '--die-with-parent',
        'org.mozilla.firefox',
        ...args
      ]

      console.log(messages.firefoxUsingFlatpakWithSandbox())
      return {binary: 'flatpak', args: flatpakArgs}
    }

    return {binary: binaryPath, args}
  }

  static async validateFirefoxBinary(
    binaryPath: string
  ): Promise<{version: string; path: string}> {
    try {
      let command: string
      let args: string[]

      if (binaryPath === 'flatpak') {
        command = 'flatpak'
        args = ['run', 'org.mozilla.firefox', '--version']
      } else {
        command = binaryPath
        args = ['--version']
      }

      const {stdout} = await exec(`${command} ${args.join(' ')}`)
      const version = stdout.trim()

      console.log(messages.firefoxVersion(version))

      return {version, path: binaryPath}
    } catch (error) {
      throw new Error(`Failed to validate Firefox binary: ${error}`)
    }
  }
}
