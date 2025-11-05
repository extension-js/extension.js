import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as crypto from 'crypto'
import {DevOptions} from '../types/options'

export function isFirstRun(outputPath: string, browser: DevOptions['browser']) {
  const distPath = path.dirname(outputPath)
  return !fs.existsSync(
    path.resolve(distPath, 'extension-js', 'profiles', `${browser}-profile`)
  )
}

function getDataDirectory(): string {
  const platform = process.platform
  const isWSL =
    (process.env as any).WSL_DISTRO_NAME || (process.env as any).WSLENV

  switch (platform) {
    case 'darwin':
      return path.join(
        os.homedir(),
        'Library',
        'Application Support',
        'extension-js'
      )
    case 'win32':
      return path.join(process.env.APPDATA || '', 'extension-js')
    case 'linux':
      if (isWSL) {
        const windowsAppData = process.env.APPDATA
        if (windowsAppData) return path.join(windowsAppData, 'extension-js')
      }
      return path.join(os.homedir(), '.config', 'extension-js')
    default:
      return path.join(os.homedir(), '.extension-js')
  }
}

function getFirstRunFlagsDir(): string {
  return path.join(getDataDirectory(), 'first-run')
}

function hashProject(projectPath: string): string {
  try {
    return crypto
      .createHash('sha1')
      .update(projectPath)
      .digest('hex')
      .slice(0, 12)
  } catch {
    return Buffer.from(projectPath).toString('hex').slice(0, 12)
  }
}

function getFirstRunFlagPath(
  projectPath: string,
  browser: DevOptions['browser']
): string {
  const dir = getFirstRunFlagsDir()
  const key = `${hashProject(projectPath)}-${browser}.flag`
  return path.join(dir, key)
}

export function hasShownFirstRunMessage(
  projectPath: string,
  browser: DevOptions['browser']
): boolean {
  try {
    const flagPath = getFirstRunFlagPath(projectPath, browser)
    return fs.existsSync(flagPath)
  } catch {
    return false
  }
}

export function markFirstRunMessageShown(
  projectPath: string,
  browser: DevOptions['browser']
): void {
  try {
    const dir = getFirstRunFlagsDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true})
    const flagPath = getFirstRunFlagPath(projectPath, browser)
    fs.writeFileSync(flagPath, '1', 'utf8')
  } catch {
    // Non-fatal; ignore persistence failure
  }
}

export function shouldShowFirstRun(
  outputPath: string,
  browser: DevOptions['browser'],
  projectPath: string
): boolean {
  const firstByProfile = isFirstRun(outputPath, browser)
  if (!firstByProfile) return false
  return !hasShownFirstRunMessage(projectPath, browser)
}
