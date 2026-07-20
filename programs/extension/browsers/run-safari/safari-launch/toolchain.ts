// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {spawnSync} from 'child_process'

export interface SafariToolchain {
  platformOk: boolean
  developerDir: string | null
  needsFullXcode: boolean
  converter: string | null
  xcodebuild: string | null
  ok: boolean
}

export function isMacOS(): boolean {
  return process.platform === 'darwin'
}

function activeDeveloperDir(): string | null {
  try {
    const result = spawnSync('xcode-select', ['-p'], {
      encoding: 'utf8',
      timeout: 15000
    })

    if (result.status !== 0) return null

    const resolved = String(result.stdout || '').trim()
    return resolved.length > 0 ? resolved : null
  } catch {
    return null
  }
}

function findWithXcrun(tool: string): string | null {
  try {
    const result = spawnSync('xcrun', ['--find', tool], {
      encoding: 'utf8',
      timeout: 15000
    })
    if (result.status !== 0) return null

    const resolved = String(result.stdout || '').trim()
    return resolved.length > 0 ? resolved : null
  } catch {
    return null
  }
}

export function detectSafariToolchain(): SafariToolchain {
  const platformOk = isMacOS()
  if (!platformOk) {
    return {
      platformOk: false,
      developerDir: null,
      needsFullXcode: false,
      converter: null,
      xcodebuild: null,
      ok: false
    }
  }

  const developerDir = activeDeveloperDir()
  // The CLT path (or no active dir) cannot provide safari-web-extension-converter
  const needsFullXcode = !developerDir || /CommandLineTools/i.test(developerDir)

  const converter = findWithXcrun('safari-web-extension-converter')
  const xcodebuild = findWithXcrun('xcodebuild')

  return {
    platformOk,
    developerDir,
    needsFullXcode,
    converter,
    xcodebuild,
    ok: Boolean(converter && xcodebuild)
  }
}
