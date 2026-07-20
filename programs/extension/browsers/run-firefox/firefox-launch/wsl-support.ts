// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {type ChildProcess, spawn} from 'child_process'
import * as fs from 'fs'
import {
  hasGuiDisplay,
  isWslEnv,
  normalizeBinaryPathForWsl
} from '../../browsers-lib/wsl-support'

export {hasGuiDisplay, isWslEnv, normalizeBinaryPathForWsl}

type FirefoxLogger = {
  warn?: (...args: unknown[]) => void
}

const LINUX_FIREFOX_PATHS = [
  '/usr/bin/firefox',
  '/snap/bin/firefox',
  '/opt/firefox/firefox'
]

// Native Linux Firefox binary for use under WSL+GUI. Returns null when not
// in WSL, when no GUI is available, or when no candidate exists on disk
export function resolveWslLinuxBinary() {
  if (!isWslEnv() || !hasGuiDisplay()) return null

  for (const candidate of LINUX_FIREFOX_PATHS) {
    if (fs.existsSync(candidate)) return candidate
  }

  return null
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
        '[browser] WSL detected: retrying with Windows Firefox binary.'
      )
      return await spawnOnce(fallbackBinary)
    }
    throw error
  }
}
