import * as fs from 'fs'
import {spawn, ChildProcess} from 'child_process'
import * as os from 'os'

type FirefoxLogger = {
  warn?: (...args: unknown[]) => void
}

export function isWslEnv(): boolean {
  // Guard against false positives on native Windows where WSLENV may be set.
  if (process.platform !== 'linux') return false

  const hasWslEnv = Boolean(
    String(process.env.WSL_DISTRO_NAME || '').trim() ||
      String(process.env.WSL_INTEROP || '').trim() ||
      String(process.env.WSLENV || '').trim()
  )
  if (hasWslEnv) return true

  // Fallback heuristic for Linux environments where env vars are unavailable.
  return /microsoft/i.test(os.release())
}

export function normalizeBinaryPathForWsl(input: string): string {
  let value = String(input || '').trim()
  if (!value) return value
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
  if (!isWslEnv()) return value
  if (/^[a-zA-Z]:[\\/]/.test(value)) {
    const drive = value[0].toLowerCase()
    const rest = value.slice(2).replace(/\\/g, '/').replace(/^\/+/, '')
    return `/mnt/${drive}/${rest}`
  }
  return value
}

export function resolveWslWindowsBinary(): string | null {
  if (!isWslEnv()) return null
  const candidates = [
    '/mnt/c/Program Files/Mozilla Firefox/firefox.exe',
    '/mnt/c/Program Files (x86)/Mozilla Firefox/firefox.exe'
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

export async function spawnFirefoxProcess(opts: {
  binary: string
  args: string[]
  stdio: any
  fallbackBinary?: string | null
  logger?: FirefoxLogger
}): Promise<ChildProcess> {
  const {binary, args, stdio, fallbackBinary, logger} = opts
  const spawnOnce = async (bin: string) => {
    const child = spawn(bin, args, {
      stdio,
      detached: false,
      env: {
        ...process.env,
        MOZ_DISABLE_AUTO_SAFE_MODE: '1',
        MOZ_CRASHREPORTER_DISABLE: '1',
        MOZ_CRASHREPORTER: '0'
      },
      ...(process.platform === 'win32' ? {windowsHide: true} : {})
    })
    await new Promise<void>((resolve, reject) => {
      const handleError = (error: unknown) => {
        child.removeListener('spawn', handleSpawn)
        reject(error)
      }
      const handleSpawn = () => {
        child.removeListener('error', handleError)
        resolve()
      }
      child.once('error', handleError)
      child.once('spawn', handleSpawn)
    })
    return child
  }

  try {
    return await spawnOnce(binary)
  } catch (error) {
    if (isWslEnv() && fallbackBinary && fallbackBinary !== binary) {
      logger?.warn?.(
        '[plugin-browsers] WSL detected: retrying with Windows Firefox binary.'
      )
      return await spawnOnce(fallbackBinary)
    }
    throw error
  }
}
