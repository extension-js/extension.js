// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

// The project and browser each live session of this process holds. The ready
// contract cannot tell two sessions of one process apart, so this does.
const claimed = new Set<string>()

function claimKey(packageJsonDir: string, browser: string): string {
  let dir = path.resolve(packageJsonDir)

  try {
    dir = fs.realpathSync.native(dir)
  } catch {
    // The resolved path stands for a folder that cannot be read.
  }

  return `${dir}\0${browser}`
}

// Synchronous, so two starts in one tick cannot both take it. Null when a
// session of this process already holds it, else the release.
export function claimDevSession(
  packageJsonDir: string,
  browser: string
): (() => void) | null {
  const key = claimKey(packageJsonDir, browser)

  if (claimed.has(key)) return null

  claimed.add(key)

  let released = false

  return () => {
    if (released) return

    released = true
    claimed.delete(key)
  }
}
